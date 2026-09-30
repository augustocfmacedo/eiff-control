# UX-P06 — Compras compacto integrado ao App (piloto somente leitura)

Frente: integração controlada do piloto congelado na UX-P05 (`245d779`, `feature/ux-p05-compras-compacto`) ao App, na
rota escondida `#/piloto/compras`, seguindo o mesmo padrão da UX-P02 (`#/piloto/financeiro`) e da UX-P04
(`#/piloto/obras`). Não substitui a tela Compras, não entra na sidebar, na paleta, no tour nem nas permissões.

- Base: `76741259a92ed2876902a2cdd6c5c79dbb0b71b6` (main após o PR #15). Desde a base da P05 (`0d8fe73`), a main só
  recebeu o PR #15, do Lead Engine, que não toca App, store, permissões, tipos, pilotos, Compras nem Estoque.
- Branch `feature/ux-p06-compras-integrado`, sem upstream. Worktree `.claude/worktrees/ux-p06-compras`. Porta 5186.
- Commit 1: `9eac4ca`, cherry-pick sem alteração de `245d779` (mesmo patch-id).
- Commit 2: `95c1d5e`, merge normal da main `bdebca7` (PR #22, fix do teste temporal do Financeiro, `c9cf6ea`); sem
  conflito. O fix entra pela main; esta frente não o reaplica.
- Commit 3: a integração da UX-P06.

## O que a integração faz

- `#/piloto/compras` (visão Diretoria) e `#/piloto/compras?visao=operacao` abrem a tela `ComprasCompacto` com o
  `Dataset`, o usuário, o estado de sincronização e o conjunto de obras visíveis que o App já tem em mãos.
- Nada é buscado pelo piloto: `entradaDoApp` (em `comprasCompactoModel.ts`) é um adaptador puro que converte o estado do
  App em `EntradaCompras` (`carregando` → carregando; `erroInicial` → erro com a mensagem; senão pronto).
- Sincronização espelhada 1:1 (`ESTADO_SYNC`: ok → sincronizado, enviando, pendente, erro, local); nunca vira
  "desatualizado". Frescor (data-base, última atualização de pedido, último movimento de estoque) é outro conceito.
- Em modo local a fonte é dita como tal: faixa "Modo local · dados do seed · não são a operação real" e rodapé "Fonte
  Modo local · seed". O seed tem zero pedidos, então a tela mostra "Sem pedidos de compra"; nenhum pedido é inventado.
- A marca "PILOTO · DADOS DE TESTE" saiu do runtime: a fixture existe só nos testes. A demo isolada da P05
  (`mainCompras.tsx`, `piloto-compras.html`) foi removida.
- `#/piloto/financeiro` e `#/piloto/obras` seguem idênticas; `#/piloto/<outro>` continua em "Página não encontrada".

## Autoridade de visibilidade (sem segunda ACL)

O conjunto de obras visíveis vem da regra oficial do store, `obrasVisiveis(usuario, ds.obras)` (sem mudança desde a
UX-P04), calculada no `App.tsx` e passada como `codigosObraVisiveis`, exatamente como no piloto de obras. O modelo não
importa store nem permissões e não lê `usuario.obras`; um teste estático (código sem comentários) prende isso.
`permissoes.ts`, `store.ts`, `types.ts` e `styles.css` não foram tocados; nenhuma permissão nova.

Semântica da P05 preservada sem mudança: pedidos emitidos ≠ custo comprometido; pedido ≠ lançamento; recebido ≠ pago;
saldo a receber ≠ necessidade; estoque físico ≠ disponível; abaixo do mínimo ≠ falta; rascunho ≠ aguardando aprovação;
ausente ≠ zero; pendências neutras (só a sugestão `obra-<cod>-direto` preserva o tom do core); carteira parcial sem
soma entre obras, nem de valores nem de contagens; estoque só com a carteira completa e só ao lado de item em kg.

## Arquivos

| Ação | Arquivo |
| --- | --- |
| Alterado | `src/App.tsx` (import do adaptador, `lazy` do piloto, ramo `p1 === 'compras'` no `case 'piloto'`) |
| Alterado | `src/screens/piloto/comprasCompactoModel.ts` (`EstadoDoApp`, `ESTADO_SYNC`, `entradaDoApp`; `VERSAO_PILOTO` UX-P06.1) |
| Alterado | `src/screens/piloto/ComprasCompacto.tsx` (faixa só de modo local; sem marca de teste) |
| Alterado | `src/screens/piloto/comprasCompacto.test.ts` (guardas da P05 sem a demo + bloco "UX-P06: integracao ao App") |
| Alterado | `src/screens/piloto/financeiroCompacto.test.ts` (guarda de lista exata agora com os três pilotos) |
| Mantido | `src/screens/piloto/comprasCompacto.fixtures.ts` (só testes), `src/screens/piloto/pilotoCompras.css` |
| Removido | `src/screens/piloto/mainCompras.tsx`, `piloto-compras.html` |
| Criado | este documento |

`docs/propostas/ux-p05-compras-compacto.md` e `src/screens/piloto/obrasCompacto.test.ts` não foram alterados: a guarda
de Obras conta só as linhas do piloto de obras e continua valendo.

## Guardas dos pilotos anteriores

A guarda da UX-P02/P04 em `financeiroCompacto.test.ts` prende a lista exata das linhas de `App.tsx` que citam "piloto".
Ela passou de 5 para 7 entradas (os três imports de adaptador, os três `lazy` e o `case`), continua exigindo que cada
linha exista uma vez e que nenhuma linha extra apareça, e passou a recusar também `piloto-compra` no App e referências ao
piloto de compras em Paleta, Tour, Sugestões, permissões, store e engine. Verificado à parte que ela reprova um quarto
piloto e a remoção de uma linha esperada. Nenhum código de produção mudou para satisfazer teste.

## Testes

`comprasCompacto.test.ts` (52): as 41 provas da P05, com as guardas de isolamento atualizadas, e o bloco UX-P06:
Dataset real (seed) no adaptador em modo local, vazio sem pedido inventado; fixture fora do runtime (só o próprio teste
importa a fixture, varredura de `src/`); `codigosObraVisiveis` da camada oficial; carteira completa, subconjunto, nenhuma
obra e código desconhecido com o mesmo resultado da entrada direta; carteira parcial sem soma, estoque oculto e kg só ao
lado de kg pelo adaptador; semântica da P05 pelo adaptador; Diretoria e Operação com os mesmos números; carregando, erro
e sync 1:1 sem "desatualizado"; entrada não mutada; `App.tsx` com a rota aditiva, Financeiro e Obras intactos, rota
inválida preservada, Inbox intacta e nada na paleta; Financeiro e Obras sem referência ao piloto de compras.

## Gates (30/09/2026, depois de incorporar a main `bdebca7`)

| Gate | Resultado |
| --- | --- |
| `comprasCompacto.test.ts` | 52 passam |
| `obrasCompacto.test.ts` | 41 passam (arquivo não alterado) |
| `financeiroCompacto.test.ts` | 47 passam |
| `src/screens/piloto` | 140 passam |
| `npm test` | 120 arquivos, 2273 passam, 8 todo, 0 falhas |
| `npx tsc --noEmit` / `npx eslint src` | 0 / 0 |
| `npm run build` | ok; chunk próprio `ComprasCompacto` |
| preflight | 57 migrations, 0 erros |

### Falha anterior, dependente de data (resolvida pela main)

`financeiroCompacto.test.ts` › "[padrao] os numeros que a demonstracao mostra sao exatamente estes" espera
`dashboard(ds).aprovacoesSlaVencido = 1`. O `dashboard` usa o relógio real (`new Date()`, `engine.ts`) e a fixture do
Financeiro tem uma aprovação com prazo em 25/09/2026; desde essa data o motor conta 2. A falha acontece igual na main
pura (`7674125`) e sem esta frente; não tem relação com Compras. Não foi corrigida aqui por estar fora da reserva
(corrigir exige fixar o relógio no teste ou mudar a data da fixture do Financeiro). Foi corrigida numa frente própria,
PR #22 (`c9cf6ea`, relógio fixado só nesse teste no `AGORA` do arquivo), mesclada na main em `bdebca7` e incorporada
aqui pelo merge `95c1d5e`. O arquivo tem o fix uma única vez; a parte desta frente nele é só a guarda dos três pilotos.

## Validação no navegador (porta 5186, modo local/seed, somente leitura)

- `#/piloto/compras` e `?visao=operacao`: "Compras compacto", faixa de modo local, chips Base 01/09 · Sem pedido
  visível · Sem movimento de estoque · Seed local · modo local · seed, estado "Sem pedidos de compra", rodapé "piloto
  UX-P06.1"; nada de "DADOS DE TESTE" nem de código da fixture.
- Usuários restritos pelo seletor do App (`u-obra`, `u-compras`): mesma tela, mesmo estado.
- `#/piloto/financeiro` e `#/piloto/obras` abrem como antes; `#/piloto/xyz` → "Página não encontrada."; `#/atendimento`
  abre o EIFF Inbox; destinos `#/compras`, `#/estoque` e `#/aprovacoes` abrem.
- Menu sem nenhuma entrada de piloto. Console sem erro nem aviso. Rede: só GET para `127.0.0.1:5186` e fontes.
- Limitação: o seed não tem pedido, obra parcial com pedidos nem estoque. Diretoria/Operação com números, gaveta,
  subconjunto com pedidos, carregando e erro não são alcançáveis em modo local; ficam cobertos pelos testes sobre a
  fixture e pelo adaptador (e foram vistos na demo isolada da P05).

## Prova de rollback

Em worktree temporário no merge `95c1d5e` (equivale a reverter só o commit de integração): `App.tsx` sem nenhuma
referência ao piloto de compras e com Financeiro, Obras e Inbox; o fix temporal da main presente; tsc e eslint limpos;
testes dos pilotos e do Inbox verdes (220). Removendo também todos os arquivos
do piloto de compras: nenhuma referência órfã em `src/`, `index.html` ou `vite.config.ts`; tsc e eslint limpos; testes
de Obras e do Inbox verdes. Nada em store, engine ou banco.

## Limitações

- O seed não tem pedidos: em modo local a tela fica vazia. Os números só aparecem com dados reais (remoto).
- Compras continua sem severidade canônica; as pendências são fatos neutros.
- A tela Compras atual lista pedidos de qualquer obra na opção "Todas as obras"; registrado, não corrigido.
- O PR #2 (Central Wave 03, parado desde 11/09) também toca o `App.tsx`.

Sem push, PR, merge, deploy, migration, ACL nova ou sidebar.

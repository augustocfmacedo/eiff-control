# UX-P08 — Produção compacto integrado ao App (piloto somente leitura)

Frente: integração controlada do piloto congelado na UX-P07 (`2bbb5febbb93a82a4b9d20722188f5d286841a0c`,
`feature/ux-p07-producao-compacto`) ao App, na rota escondida `#/piloto/producao`, seguindo o mesmo padrão da UX-P02
(`#/piloto/financeiro`), da UX-P04 (`#/piloto/obras`) e da UX-P06 (`#/piloto/compras`). Não substitui a tela Fábrica e
montagem (`#/producao`), não entra na sidebar, na paleta, no tour nem nas permissões.

- Base: `a002011d151f1b3365102d9c909847f42df2d074` (main após o PR #23). A main não avançou desde a base histórica da P07.
- Precheck: nenhum PR aberto ou worktree com alteração não commitada toca App, store, permissões, tipos, pilotos,
  Produção ou Estoque. O PR #25 (rascunho, Mission Control V2B) só toca `styles.css`, que esta frente não altera. O PR #2
  (parado desde 11/09) toca App e store, como já registrado nas frentes anteriores. A branch `fix/teste-piloto-relogio`
  continua viva, sem PR e fora da main; ela altera o mesmo `financeiroCompacto.test.ts` desta frente e daria conflito se
  fosse mesclada. Não foi tocada.
- Branch `feature/ux-p08-producao-integrado`, sem upstream. Worktree `.claude/worktrees/ux-p08-producao`. Porta 5188.
- Commit 1: cherry-pick sem alteração de `2bbb5fe` (mesmo patch-id `97f0e8dd`).
- Commit 2: a integração da UX-P08.

## O que a integração faz

- `#/piloto/producao` (visão Diretoria) e `#/piloto/producao?visao=operacao` abrem a tela `ProducaoCompacto` com o
  `Dataset`, o usuário, o estado de sincronização e o conjunto de obras visíveis que o App já tem em mãos.
- Nada é buscado pelo piloto: `entradaDoApp` (em `producaoCompactoModel.ts`) é um adaptador puro que converte o estado do
  App em `EntradaProducao` (`carregando` → carregando; `erroInicial` → erro com a mensagem; senão pronto).
- Sincronização espelhada 1:1 (`ESTADO_SYNC`: ok → sincronizado, enviando, pendente, erro, local); nunca vira
  "desatualizado". Frescor (data-base, último apontamento, última atualização da lista de materiais) é outro conceito.
- Em modo local a fonte é dita como tal: faixa "Modo local · dados do seed · não são a operação real" e rodapé "Fonte
  Modo local · seed". O seed tem zero ordens, conjuntos, apontamentos e romaneios, então a tela mostra "Sem dados de
  produção"; nada é inventado.
- A marca "PILOTO · DADOS DE TESTE" saiu do runtime: a fixture existe só nos testes. A demo isolada da P07
  (`mainProducao.tsx`, `piloto-producao.html`) foi removida.
- `#/piloto/financeiro`, `#/piloto/obras` e `#/piloto/compras` seguem idênticas; `#/piloto/<outro>` continua em
  "Página não encontrada".

## Autoridade de visibilidade (sem segunda ACL)

O conjunto de obras visíveis vem da regra oficial do store, `obrasVisiveis(usuario, ds.obras)` (sem mudança desde a
UX-P04), calculada no `App.tsx` e passada como `codigosObraVisiveis`, exatamente como nos pilotos de Obras e Compras. O
modelo não importa store nem permissões e não lê `usuario.obras`; testes estáticos prendem isso. `permissoes.ts`,
`store.ts`, `types.ts` e `styles.css` não foram tocados; nenhuma permissão nova.

## Semântica preservada (sem mudança desde a P07)

Fabricação ≠ montagem; fabricado ≠ expedido ≠ montado; kg em fábrica ≠ material faltante; kg em canteiro ≠ montagem
concluída; ordem atrasada ≠ serviço atrasado; ordem sem data ≠ ordem atrasada; estoque físico ≠ material disponível;
percentual da ordem (por etapas) ≠ percentual por kg; execução física do serviço ≠ produção da ordem; ausente ≠ zero.
Agregadores canônicos sobre a coleção já filtrada pelas obras visíveis, rotulada "obras visíveis", sem soma no piloto;
ALT-07, ALT-09 e `ordens-sem-data` só com a carteira completa. kg processado por HH só na composição. Pendências neutras;
tom só de sugestões, checks e pontos "Produção" da análise, preservado 1:1; semáforo geral nunca usado. Não existe
conceito canônico de bloqueio de produção; tarefas e Mission Control ficam fora. Sem ligação produção → compra.

## Arquivos

| Ação | Arquivo |
| --- | --- |
| Alterado | `src/App.tsx` (import do adaptador, `lazy` do piloto, ramo `p1 === 'producao'` no `case 'piloto'`) |
| Alterado | `src/screens/piloto/producaoCompactoModel.ts` (`EstadoDoApp`, `ESTADO_SYNC`, `entradaDoApp`; `VERSAO_PILOTO` UX-P08.1) |
| Alterado | `src/screens/piloto/ProducaoCompacto.tsx` (faixa só de modo local; sem marca de teste) |
| Alterado | `src/screens/piloto/producaoCompacto.test.ts` (guardas da P07 sem a demo + bloco "UX-P08: integracao ao App") |
| Alterado | `src/screens/piloto/financeiroCompacto.test.ts` (guarda de lista exata agora com os quatro pilotos) |
| Mantido | `src/screens/piloto/producaoCompacto.fixtures.ts` (só testes), `src/screens/piloto/pilotoProducao.css` |
| Removido | `src/screens/piloto/mainProducao.tsx`, `piloto-producao.html` |
| Criado | este documento |

`docs/propostas/ux-p07-producao-compacto.md`, `obrasCompacto.test.ts` e `comprasCompacto.test.ts` não foram alterados:
as guardas de Obras e Compras contam só as linhas do próprio piloto e continuam valendo.

## Guardas dos pilotos anteriores

A guarda da UX-P02/P04/P06 em `financeiroCompacto.test.ts` prende a lista exata das linhas de `App.tsx` que citam
"piloto". Ela passou de 7 para 9 entradas (quatro imports de adaptador, quatro `lazy` e o `case`), continua exigindo
que cada linha exista uma vez e que nenhuma linha extra apareça (um quinto piloto reprova), e passou a recusar também
`piloto-producao` no App e referências ao piloto de produção em Paleta, Tour, Sugestões, permissões, store e engine.
Antes do ajuste, a própria guarda reprovou a nova rota, o que confirma que ela funciona. Nenhum código de produção mudou
para satisfazer teste.

## Testes

`producaoCompacto.test.ts`: as provas da P07, com as guardas de isolamento atualizadas (sem demo; fixture importada só
por este teste; fora da pasta só o App cita o piloto), e o bloco UX-P08: Dataset real (seed) no adaptador em modo
local, vazio sem dado inventado; fixture fora do runtime; `codigosObraVisiveis` da camada oficial; carteira completa,
uma obra, várias obras, nenhuma e código desconhecido com o mesmo resultado da entrada direta; subconjunto sem
vazamento, agregação canônica, nenhuma soma, globais só com a carteira completa; semântica da P07 pelo adaptador;
Diretoria e Operação com os mesmos números; carregando, erro e sync 1:1 sem "desatualizado"; entrada não mutada; sem
store, Supabase ou efeito externo; `App.tsx` com a rota aditiva, Financeiro, Obras e Compras intactos, rota inválida
preservada, tela `#/producao` intacta, Inbox e Mission Control intactos e nada na paleta ou na navegação.

## Limitações

- O seed não tem dados de produção: em modo local a tela fica vazia. Os números só aparecem com dados reais (remoto).
- Produção continua sem severidade canônica própria; as pendências são fatos neutros.
- A tela Fábrica e montagem e o modo quiosque mostram produtividade e romaneios de obras não visíveis com "Todas as
  obras"; registrado na P07, não corrigido.
- O PR #2 (Central Wave 03, parado desde 11/09) também toca o `App.tsx`; a branch `fix/teste-piloto-relogio` toca o
  teste do Financeiro.

## Rollback

Reverter só o commit de integração remove `#/piloto/producao` e preserva Financeiro, Obras e Compras compactos, Inbox,
Mission Control e o restante do App. O piloto congelado da P07 (commit 1) volta a ser o estado da branch, com a demo
isolada. Nada em store, engine, banco ou permissões.

Sem push, PR, merge, deploy, migration, ACL nova ou sidebar.

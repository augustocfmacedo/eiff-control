# UX-P04 — Obras compacto integrado ao App (piloto somente leitura)

Frente: integração controlada do piloto congelado na UX-P03 (`e2443ff`, `feature/ux-p03-obras-compacto`) ao App,
na rota escondida `#/piloto/obras`, seguindo o mesmo padrão da UX-P02 (`#/piloto/financeiro`).
Base: `7e0aa613` (main após o merge do EIFF Inbox, PR #13). Branch `feature/ux-p04-obras-integrado`, worktree
`.claude/worktrees/ux-p04-obras`, porta 5184, sem upstream.

## O que a integração faz

- `#/piloto/obras` (visão Diretoria) e `#/piloto/obras?visao=operacao` abrem a tela `ObrasCompacto` com o
  `Dataset`, o usuário, o estado de sincronização e o conjunto de obras visíveis que o App já tem em mãos.
- Nada é buscado pelo piloto: `entradaDoApp` (em `obrasCompactoModel.ts`) é um adaptador puro que converte o estado do
  App em `EntradaObras` (`carregando` → estado carregando; `erroInicial` → estado erro com a mensagem; senão pronto).
- Sincronização é espelhada 1:1 (`ESTADO_SYNC`: ok → sincronizado, enviando, pendente, erro, local); nunca vira
  "desatualizado". Frescor (data-base, última medição, último avanço) continua um conceito separado.
- Em modo local a fonte é dita como tal: faixa "Modo local · dados do seed · não são a operação real" e rodapé
  "Fonte Modo local · seed". A marca "PILOTO · DADOS DE TESTE" saiu do runtime (a fixture existe só nos testes).
- Rota inválida do piloto (`#/piloto/xyz`) continua em "Página não encontrada."; `#/piloto/financeiro` segue idêntica.

## Autoridade de visibilidade (sem segunda ACL)

O conjunto de obras visíveis vem da regra oficial do store, `obrasVisiveis(usuario, ds.obras)`, calculada no `App.tsx`
e passada explicitamente como `codigosObraVisiveis`. O modelo do piloto nunca importa `store`, `permissoes` nem lê
`usuario.obras`; um teste estático (código sem comentários) prende isso. `permissoes.ts`, `store.ts`, `types.ts` e
`styles.css` não foram tocados; nenhuma permissão nova, nenhuma entrada em `ROTAS_NAV`, Paleta, Tour ou Sugestões.

Agregados da carteira inteira só aparecem quando todas as obras estão visíveis; subconjunto mostra "carteira inteira
não visível" (semântica da UX-P03 preservada, com a severidade canônica do motor e sem rótulos temporais).

## Arquivos

| Ação | Arquivo |
| --- | --- |
| Alterado | `src/App.tsx` (import de `obrasVisiveis` e do adaptador, `lazy` do piloto, ramo `p1 === 'obras'` no `case 'piloto'`) |
| Alterado | `src/screens/piloto/ObrasCompacto.tsx` (faixa só de modo local; sem fixture) |
| Alterado | `src/screens/piloto/obrasCompactoModel.ts` (`EstadoDoApp`, `ESTADO_SYNC`, `entradaDoApp`; `VERSAO_PILOTO` UX-P04.1) |
| Alterado | `src/screens/piloto/obrasCompacto.test.ts` (guardas da P03 ajustadas + bloco "UX-P04: integracao ao App") |
| Mantido | `src/screens/piloto/obrasCompacto.fixtures.ts` (só testes), `src/screens/piloto/pilotoObras.css` |
| Removido | `src/screens/piloto/mainObras.tsx`, `piloto-obras.html` (isolamento da P03) |
| Alterado (autorização pontual) | `src/screens/piloto/financeiroCompacto.test.ts` (guarda da UX-P02 sobre o `App.tsx`, ver abaixo) |
| Criado | este documento |

`docs/propostas/ux-p03-obras-compacto.md` não foi alterado. A lógica do Inbox no `App.tsx` não foi tocada
(diff do App: 9 linhas, aditivo).

## Testes

`obrasCompacto.test.ts`: os testes da P03 continuam (modelo puro contra o motor, severidade canônica, sync ≠ frescor,
subconjunto, sem store/rede/gravação, sem mutação do Dataset) e o bloco UX-P04 cobre o adaptador
(`carregando`/`erro`/`pronto`, mapa de sync, modo local, `codigosObraVisiveis` repassado sem alteração, nenhuma
mutação da entrada), a rota no App (ramo `obras` aditivo, ramo `financeiro` byte a byte igual ao da P02, rota inválida
preservada, Inbox intacta, sem sidebar/paleta/tour/permissão), a ausência da fixture no runtime e a independência do
piloto financeiro. Rodada com o seed real (`src/data/seed.json`).

## Gates (24/09/2026, worktree ux-p04-obras)

| Gate | Resultado |
| --- | --- |
| `npx vitest run src/screens/piloto` | 88 passam (financeiro 47, obras 41) |
| `npm test` | 114 arquivos, 2155 passam, 8 todo, 0 falhas |
| `npx tsc --noEmit` | 0 erros |
| `npx eslint src` | 0 erros |
| `npm run build` | ok (só o aviso habitual de chunk > 500 kB) |
| `node scripts/pg-preflight-central.mjs --ordem-corrigida` | 55 migrations aplicadas, 0 com erro |

## Validação no navegador (porta 5184, modo local/seed, Chrome headless + CDP, somente leitura)

- Diretoria (`u-augusto`): "Obras compacto", faixa de modo local, chips Base 01/09 · Sem medição registrada · Sem
  avanço apontado · Seed local · modo local · seed; tiles Carteira contratada R$ 1.291.500,00 · Margem projetada
  34,2% · Saúde 0/0/1; 1 obra; Atenção vazia; rodapé "piloto UX-P04.1".
- Operação (`?visao=operacao`): Avanço físico 0% · Medições 0/0 · Serviços 0 atrasados · 1 em risco · Produção 0/0.
- Gaveta: "Obra 360 · Smart Fit - Avenida César Lattes" (11 grandezas, origem `obra360(ds, obra)`), Esc fecha,
  "Ver origem no EIFF Control" leva a `#/obras/OB-SF-CL-01`. No seed nenhum tile tem composição clicável; a gaveta
  foi aberta pelo botão da linha da obra.
- Usuário restrito (`u-obra` Gestor de obra e `u-eng` Engenharia, obras = [OB-SF-CL-01]): a tela abre com a mesma
  obra; como o seed só tem essa obra, o conjunto visível é a carteira inteira. O estado "subconjunto" e o estado
  "nenhuma obra visível" não são simuláveis no seed (nenhum usuário tem lista vazia) e ficam cobertos pelos testes.
- Estados carregando/erro: não alcançáveis em modo local (o seed carrega de imediato e não há falha remota);
  cobertos pelos testes do adaptador.
- `#/piloto/financeiro`: "Financeiro compacto", 3 tiles, sem nenhum elemento do piloto de obras.
- `#/piloto/xyz`: "Página não encontrada.". `#/atendimento`: "EIFF Inbox" abre normalmente.
- Sidebar/paleta: nenhuma entrada "piloto". Console: 0 erros e 0 avisos em todos os cenários.
- Rede: só GET (Document, Script, Stylesheet, Manifest, Font) para `127.0.0.1:5184`, `fonts.googleapis.com` e
  `fonts.gstatic.com`; nenhum fetch/XHR/WebSocket, nenhum POST.

Capturas: `p04-01-diretoria`, `p04-02-gaveta`, `p04-03-operacao`, `p04-04-gestor-obra`, `p04-05-inbox` (scratchpad).

## Prova de rollback

Em worktree temporário no estado equivalente a reverter só o commit de integração (`f1b59c0`, cherry-pick da P03):
`App.tsx` sem nenhuma referência ao piloto de obras; removendo também os arquivos do piloto de obras não sobra
referência órfã em `src/`, `index.html` ou `vite.config.ts`; `tsc` 0, `eslint` 0, testes de `src/screens/piloto` e
`src/core/inbox` verdes (97). O piloto financeiro e o Inbox ficam intactos.

## Guarda da UX-P02 atualizada (autorização pontual de 24/09/2026)

`src/screens/piloto/financeiroCompacto.test.ts` contava as linhas não comentadas de `App.tsx` com "piloto" e exigia
exatamente 3 (época do piloto único). A guarda foi fortalecida, não afrouxada: agora prende a lista EXATA das
integrações esperadas (`INTEGRACOES_ESPERADAS`: import do adaptador e `lazy` do Financeiro compacto, import do
adaptador e `lazy` do Obras compacto, e o `case 'piloto'` com o financeiro primeiro), exige que toda linha com "piloto"
case com exatamente uma delas e que cada uma exista uma vez, recusa fixture no runtime (`fixtures`, `DADOS DE TESTE`)
e qualquer ligação a `ROTAS_NAV`, e a varredura de Paleta/Tour/Sugestões/permissões/store/engine passou a cobrir também
o piloto de obras. Verificado à parte que a guarda reprova uma linha extra ("terceiro piloto"), a remoção de uma linha
esperada e um import de fixture. Nenhum código de produção mudou para satisfazer o teste. Como o teste do financeiro
passou a citar as linhas do obras no App, o teste 17 do obras exige agora que nenhum arquivo de RUNTIME do financeiro
cite o obras e que o teste do financeiro nunca importe nada dele.

## Commits

1. `f1b59c0` — cherry-pick de `e2443ff` ("UX-P03: freeze obras compacto validated pilot"), sem alteração.
2. "UX-P04: integrate obras compacto read-only pilot" — a integração, a remoção do isolamento, este documento e a guarda
   atualizada.

Sem push, PR, merge, deploy, migration, ACL nova ou sidebar.

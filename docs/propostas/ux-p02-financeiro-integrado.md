# UX-P02 — Integração controlada do Financeiro compacto (`#/piloto/financeiro`)

Estado: **integração implementada e validada localmente na branch `feature/ux-p02-financeiro-integrado`, em dois commits
locais (cherry-pick do piloto congelado + commit de integração). Sem push, merge ou deploy.** Base `origin/main @ d063194`
(23/09/2026). O documento da UX-P01 (`ux-p01-financeiro-compacto.md`) é histórico congelado e não foi alterado.

## 1. O que entrou

A rota experimental `#/piloto/financeiro` dentro do EIFF Control real, somente leitura, sem substituir tela alguma:

```text
App (useStore já lido) → entradaDoApp(ds, usuario, modo, carregando, erroInicial, sync, agora)
  → financeiroCompactoModel.montarPiloto → funções canônicas do core → FinanceiroCompacto
```

- **Sem sidebar, sem `ROTAS_NAV`, sem paleta, sem tour, sem permissão nova.** O acesso é pela URL; dentro da tela a
  permissão continua sendo `pode(usuario, 'ver_bancos')` do core (saldo e projeção ficam "restrito (ver_bancos)").
- **O piloto não importa o store.** `App.tsx` ganhou exatamente três linhas: o import do adaptador puro `entradaDoApp`, o
  `lazy` da tela e o `case 'piloto'` que passa explicitamente o que o App já tem. Um teste estático fixa essas três linhas.
- **Sem fetch, subscription, cliente Supabase, polling, listener global, persistência, ACL ou fórmula financeira.** As guardas
  estáticas do piloto (pasta sem `data/store`, `data/supabase`, `data/offline`, `data/telemetria`, `fetch`, `XMLHttpRequest`,
  `WebSocket`, `serviceWorker`, `localStorage`, `sessionStorage`, `indexedDB`, `sendBeacon`) continuam valendo.
- **Dados de teste fora do runtime.** A tela e o modelo não importam a fixture nem citam "DADOS DE TESTE" (teste garante);
  a fixture segue existindo só para os testes. Em modo local a tela diz "Modo local · dados do seed · não são a operação real".

## 2. Sincronização × frescor (conceitos separados)

`entradaDoApp` espelha `sync.status` 1:1 em `fonte.sincronizacao` (`ok → sincronizado`, `enviando`, `pendente`, `erro`,
`local`) e a tela mostra isso num chip próprio, com o mesmo vocabulário da barra superior. O **frescor** (base, extrato
até, idade do dado pela `sync.em`) é outro grupo de chips e **não muda** quando o sync está pendente ou com erro: o teste
compara o frescor dos três estados e exige igualdade. Nenhuma interpretação gerencial nova foi criada para o sync.

## 3. Navegação

Só destinos e filtros já implementados pelas telas de destino, confirmados no código: `Lancamentos` lê `situacao`
(igualdade com a situação do motor) e `status`; as demais são rotas base.

| Item do piloto | Destino |
|---|---|
| Caixa hoje · extrato | `#/posicao` |
| Projeção / caixa abaixo da reserva | `#/fluxo13` |
| Recebíveis vencidos | `#/receber?situacao=Atrasado` |
| Pagamentos vencidos | `#/pagar?situacao=Atrasado` |
| Próximos 7 dias | `#/receber` e `#/pagar` com `situacao=Próximos 7 dias` |
| Sem conciliação / extrato sem lançamento | `#/conciliacao` |
| Aprovações | `#/aprovacoes` |
| Linha de composição | `#/lancamentos/<id>` |
| Controles | `#/checks` |

Nenhum contrato novo de query string foi criado. O único parâmetro que a rota do piloto lê é `?visao=operacional`, prop de
apresentação da própria tela.

## 4. Arquivos tocados pelo commit de integração

| Arquivo | Mudança |
|---|---|
| `src/App.tsx` | +5 linhas: import de `entradaDoApp`, `lazy` da tela, `case 'piloto'` (2 comentários) |
| `src/screens/piloto/financeiroCompactoModel.ts` | `Sincronizacao`, `EstadoDoApp`, `entradaDoApp`; chip "Seed local" em modo local; versão `UX-P02.1` |
| `src/screens/piloto/FinanceiroCompacto.tsx` | sai o import da fixture e a faixa de teste; entra `FaixaLocal` (modo local) e `ChipSync`; rodapé |
| `src/screens/piloto/financeiroCompacto.test.ts` | 47 provas (+7): adaptador, separação sync × frescor, modo local, guardas do App e dos arquivos removidos |
| `src/screens/piloto/main.tsx` | **removido** (entrada isolada) |
| `piloto-financeiro.html` | **removido** (página isolada) |
| `docs/propostas/ux-p02-financeiro-integrado.md` | este documento |

Mantidos sem alteração: `piloto.css`, `financeiroCompacto.fixtures.ts`, `docs/propostas/ux-p01-financeiro-compacto.md`.
Não tocados: `CLAUDE.md`, store, engine, permissões, Paleta, Tour, Sugestoes, migrations, funções Netlify, dependências.

## 5. Verificações executadas (23/09/2026)

| Verificação | Resultado real |
|---|---|
| `npx vitest run src/screens/piloto` | 47 testes passaram |
| `npm test` (suíte inteira) | 102 arquivos, 1852 testes passaram, 8 todo |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src` | exit 0 |
| `npm run build` | built, exit 0; nenhum arquivo gerado fora de `dist/` |
| `node scripts/pg-preflight-central.mjs --ordem-corrigida` (passo do Quality Gate) | 54 migrations aplicadas, 0 com erro, rollback ok |
| Navegador, modo local (worktree sem `.env`, seed), porta 5182 | abriu `#/piloto/financeiro` (Executivo e Operacional) |
| Ida e volta pelos destinos | `/receber?situacao=Atrasado`, `/pagar?situacao=Atrasado`, `/posicao`, `/fluxo13`, `/conciliacao`, `/aprovacoes` renderizaram seus títulos e o piloto voltou; `#/piloto/outra` → "Página não encontrada." |
| Console | sem erros (só cliente do Vite e aviso do React DevTools) |
| Rede | hosts: `127.0.0.1:5182` e a folha de fontes do Google já usada pelo `index.html`; **zero** fetch/XHR/beacon, zero WebSocket, sem service worker; os únicos recursos com "supabase" no nome são módulos locais do próprio App (`src/data/supabase.ts`, `radar.supabase.ts`, `@supabase/supabase-js`), carregados pelo store como em qualquer rota |
| Sidebar | nenhum link para `piloto` |
| Tour | não abre sozinho na rota (não há `.page-head`) |
| Usuário sem `ver_bancos` (select do App, "Gestor Smart Fit") | caixa e projeção "restrito (ver_bancos)", vencidos e atenção seguem visíveis |
| Composição | gaveta abre pelo tile e pela linha; "Saldo projetado por semana" com 13 linhas e origem; "Recebíveis vencidos" |

Paridade: as provas de paridade da UX-P01 continuam (caixa = `saldoBancarioHoje`, vencidos = `pagamentosVencidos` /
`recebiveisVencidos`, projeção = `dashboard.menorSaldo13s`/`necessidadeMaxima`/`saldoFinal13s`, pendências = três contagens
canônicas sem total) e um teste novo prova que o modelo montado pelo adaptador é idêntico ao montado pela entrada direta,
inclusive a permissão.

Modo remoto (Supabase real) **não foi exercitado**: a worktree não tem credenciais e a reserva proíbe carregá-las. O
adaptador para esse caso é coberto por teste puro (`sync` ok/enviando/pendente/erro).

Capturas (no scratchpad da sessão, fora do repositório): `p02-01-app-executivo`, `p02-02-app-operacional`,
`p02-03-app-restrito`, `p02-04-app-composicao-projecao`, `p02-05-app-operacional-composicao-vencidos`.

## 6. Rollback e desativação

**Reverter o commit de integração** devolve `App.tsx` ao estado anterior (a rota volta a "Página não encontrada") e recoloca os
dois arquivos de isolamento; **apagar `src/screens/piloto/` e este documento** remove o resto. Nada mais referencia a pasta:
store, engine, permissões, Paleta, Tour, Sugestoes, migrations e funções Netlify não a conhecem (o teste "o App liga o piloto
só por lazy + case" varre esses arquivos). A prova executada está na seção 7.

Ordem segura:
1. `git revert <commit de integração>` (ou remover as três linhas de `App.tsx`);
2. `git rm -r src/screens/piloto docs/propostas/ux-p02-financeiro-integrado.md` (e, se quiser apagar o histórico do piloto, também `docs/propostas/ux-p01-financeiro-compacto.md`);
3. `npx tsc --noEmit && npx eslint src && npm test`.

Nenhum estado a restaurar: não há migration, schema, chave, storage nem configuração de deploy envolvidos.

## 7. Prova de rollback

Executada numa worktree temporária a partir do commit de integração: revert do commit + remoção da pasta do piloto e deste
documento → `tsc`, `eslint`, suíte e busca por referências órfãs. Resultado registrado no relatório da entrega.

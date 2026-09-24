# UX-P05 — Compras compacto (piloto isolado, somente leitura)

**Estado: PILOTO ISOLADO, congelado.** Não está integrado ao App, não tem rota, não aparece em menu, paleta ou tour.
Só roda na demo isolada (`vite dev`) e nos testes.

Frente: aplicar ao domínio de Compras a filosofia validada no Financeiro compacto (UX-P01/P02) e no Obras compacto
(UX-P03/P04). Não é uma versão menor da tela Compras: é uma entrada de decisão que responde o que está pendente no
fluxo de compras, em qual obra, com qual prazo de entrega e onde aprofundar.

- Base: `0d8fe7376337cfc422726db1067ae2cc7a8fbd1a` (main após o PR #19). A main não avançou entre a inspeção e o início.
- Branch `feature/ux-p05-compras-compacto`, sem upstream. Worktree `.claude/worktrees/ux-p05-compras`. Porta 5185.
- Demo isolada: `http://127.0.0.1:5185/piloto-compras.html`, só em `vite dev`; o build empacota apenas `index.html`.

## Arquivos (reserva exata)

| Arquivo | Papel |
| --- | --- |
| `src/screens/piloto/comprasCompactoModel.ts` | view-model puro: seleciona, agrupa, ordena e rotula o que o core devolve |
| `src/screens/piloto/ComprasCompacto.tsx` | tela somente leitura |
| `src/screens/piloto/pilotoCompras.css` | estilos sob `.piloto-compra`, só tokens |
| `src/screens/piloto/comprasCompacto.fixtures.ts` | dados fictícios "PILOTO · DADOS DE TESTE" (demo e testes) |
| `src/screens/piloto/comprasCompacto.test.ts` | provas do modelo e guardas estáticas |
| `src/screens/piloto/mainCompras.tsx` | entrada da demo isolada (só dev) |
| `piloto-compras.html` | página da demo isolada (só dev) |
| `docs/propostas/ux-p05-compras-compacto.md` | este documento |

Nenhum arquivo existente foi alterado: App, store, engine, core, permissões, tipos, `styles.css`, migrations, os
pilotos de Financeiro e Obras, Inbox, Central, Comercial, Mission Control e Factory estão intocados.

## Arquitetura

```
EntradaCompras (fixture na demo e nos testes; numa integração futura, o App)
  → montarCompras (comprasCompactoModel.ts, puro)
      lê: resumoCompras · comparativoOrcadoComprado · obra360 · calcLancamentos · posicaoEstoque · sugestoesPara
      devolve: ModeloCompras (carregando | erro | vazio | sem-visibilidade | pronto)
  → ComprasCompacto.tsx (só apresenta: tiles, obras ou pedidos, pendências, gaveta de composição)
```

A entrada é um contrato explícito: Dataset, usuário, `codigosObraVisiveis`, fonte (com a sincronização do App) e o
instante `agora`. O modelo não lê relógio, navegador, store nem rede. A tela guarda só estado de interface (visão,
gaveta aberta, "ver todos").

## Fontes canônicas consumidas

| Função | Arquivo | O que o piloto usa |
| --- | --- | --- |
| `resumoCompras(ds, codigoObra?)` | `src/core/compras.ts` | pedidos com `calcPedido`, emitido, recebido, aReceber, rascunhos, atrasados, aguardandoAprovacao |
| `calcPedido(p, ds, dataBase)` (via `resumoCompras`) | `src/core/compras.ts` | total, totalRecebido, pctRecebido, atrasado, diasParaEntrega, itens com `saldoReceber` e `desvioPreco`, lançamento |
| `comparativoOrcadoComprado(ds, codigoObra)` | `src/core/compras.ts` | orçado × comprado por insumo, compradoForaOrcamento |
| `obra360(ds, obra, lancs).custoComprometido` | `src/core/engine.ts` | custo comprometido da obra, só na composição |
| `calcLancamentos(ds)` | `src/core/engine.ts` | `oficial` do lançamento do pedido (entra ou não no comprometido) |
| `posicaoEstoque(ds)` | `src/core/estoque.ts` | saldo físico em kg, itens abaixo do mínimo, só com a carteira completa |
| `sugestoesPara('/obras/<cod>')` | `src/core/sugestoes.ts` | só a sugestão `obra-<cod>-direto`, com o tom do core |

O modelo importa apenas essas funções e os tipos (lista fechada presa por teste). Nada é recalculado.

## Classificação final das métricas

| Classe | Métricas |
| --- | --- |
| A, pronta | pedidos emitidos, recebido e a receber em R$; rascunhos; pedidos atrasados; aguardando aprovação; por pedido: status, total, recebido, percentual recebido, entrega prevista e `diasParaEntrega`; saldo a receber por item; saldo físico e itens abaixo do mínimo do estoque |
| B, com contexto | pedidos emitidos × custo comprometido (grandezas diferentes, lado a lado na composição); orçado × comprado só por obra e em unidade do insumo; desvio de preço contra o catálogo (não é cotação); pedido "ativo" com lançamento em Rascunho; estoque só de aço e global; etapas da aprovação (papel, não pessoa) |
| C, derivável, não implementado | lead time; saldo a receber do pedido em R$; data de recebimento; etapa corrente da aprovação como "responsável"; necessidade não coberta (orçado − comprado); estoque por pedido |
| D, ausente | solicitação, cotação, proposta, cadastro de fornecedor, reserva, disponível, falta líquida, data de necessidade do material, comprador, material crítico, bloqueio de obra ou produção por compra |

## Decisões aplicadas

1. **Pendências sem severidade.** O domínio de compras não tem severidade canônica: nenhuma sugestão para `/compras`
   ou `/estoque` e nenhum check do motor sobre pedido. As pendências são fatos neutros, sem bad/warn/info, sem score e
   sem ordem de prioridade; a ordem é a do catálogo de tipos (`TIPOS_PENDENCIA`). Tipos: pedido com entrega atrasada,
   lançamento aguardando aprovação, pedido emitido · lançamento em Rascunho, lançamento vinculado não encontrado,
   pedido em rascunho, comprado fora do orçamento, itens de estoque abaixo do mínimo, faturamento direto acima do
   saldo contratado. Só o último vem de uma sugestão do core e preserva o tom dela ("sinalizado pelo sistema").
2. **Pedidos emitidos ≠ custo comprometido.** Os tiles dizem "Pedidos emitidos" (`resumoCompras.emitido`). O custo
   comprometido (`obra360.custoComprometido`) só aparece na composição "Emitido × comprometido" de cada obra, ao lado
   do emitido, cada um com a sua função e regra. Nenhuma diferença é calculada. A composição lista os pedidos ativos e
   diz, pelo `oficial` do motor, quais lançamentos ainda não entram no comprometido. Divergência documentada:
   `resumoCompras.emitido` inclui pedido com lançamento Pendente; `obra360.custoComprometido` não inclui esse valor e
   inclui custos diretos da obra que não vieram de pedido. Na fixture, a obra A tem R$ 95.400,00 em pedidos emitidos
   e R$ 129.400,00 de custo comprometido.
3. **Estoque só com a carteira completa.** O estoque é global e só de aço. Com subconjunto visível o piloto não mostra
   saldo, itens abaixo do mínimo, chip de último movimento nem estoque do insumo na composição do pedido; a legenda
   diz "Estoque global indisponível nesta visão".
4. **Pedido emitido com lançamento em Rascunho** aparece como fato ("Pedido emitido · lançamento em Rascunho"), sem
   afirmar rejeição.

Regra central respeitada: nada de "precisa comprar", "faltante", "bloqueado" ou necessidade líquida. O único saldo de
quantidade é o `saldoReceber` de cada item, e as composições dizem que comprado não é necessidade.

## Situação

| Visão | Pergunta | Tiles |
| --- | --- | --- |
| Diretoria | Onde Compras cria pendência para a operação? | Pedidos emitidos (recebido e a receber como partes), Pedidos atrasados, Aguardando aprovação |
| Operação | O que resolver agora no fluxo de compras? | Rascunhos, Aguardando aprovação, A receber (pedidos emitidos e recebido como partes), Pedidos atrasados |

Os dois conjuntos são os mesmos objetos (`tiles`): a visão só escolhe quais mostrar, e os números não mudam. Nenhum
tile tem cor de estado.

Abaixo dos tiles, a Diretoria vê uma linha por obra com pedidos (valores de `resumoCompras(ds, obra)`) e a Operação vê
os pedidos em aberto (Rascunho, Emitido, Recebido parcial) com fornecedor, obra, status, entrega prevista, total,
recebido, itens com saldo, estado do lançamento e "criado por". A ordem é por previsão de entrega, sem previsão por
último; não é prioridade. Tetos: 3 tiles na Diretoria, 4 na Operação, 8 pedidos e 6 pendências antes de "ver todos".

## Visibilidade

O piloto recebe `codigosObraVisiveis` e filtra os pedidos por esse conjunto. Não importa store, não reproduz
`obrasVisiveis` e não cria ACL. Regras:

- carteira completa = todas as obras e todos os pedidos dentro do conjunto; só então os valores globais aparecem;
- uma única obra visível: os valores são os daquela obra, ditos como tal ("somente OB-…");
- mais de uma obra, sem a carteira inteira: valores em R$ e contagens ficam "carteira inteira não visível" e os
  números ficam por obra na lista (`resumoCompras(ds, obra)`); o piloto nunca soma resultados de obras diferentes;
- nenhuma obra visível ou só códigos desconhecidos: estado "Nenhuma obra visível";
- a regra de leitura de pedidos não existe no core. A tela Compras atual, com "Todas as obras", lista pedidos de
  qualquer obra mesmo para usuário restrito; isso fica registrado e não é corrigido aqui.

## Revisões do congelamento

- **Terminologia de atraso.** `calcPedido.atrasado` é uma propriedade do pedido: pedido ativo, não recebido por
  inteiro, cuja data prevista de entrega já passou em relação à data-base. O domínio não tem entidade "entrega" nem
  prazo formal vencido. Os rótulos passaram de "Entregas vencidas" para "Pedidos atrasados" (tile), "Pedido com entrega
  atrasada" (pendência) e "previsão dd/mm · atrasado N dias" (linha). A regra não mudou; só o rótulo.
- **Nenhuma soma entre obras, nem de contagens.** Com várias obras visíveis e a carteira incompleta, os tiles de
  contagem (pedidos atrasados, aguardando aprovação, rascunhos) somavam o resultado de cada obra. Agora seguem a mesma
  regra dos valores em R$: global com a carteira completa, `resumoCompras(ds, obra)` com uma única obra, e "carteira
  inteira não visível" nos demais casos, com os números por obra na lista. Consequência aceita: na Operação com carteira
  parcial os quatro tiles ficam sem número, e a leitura passa a ser a lista de pedidos e as linhas por obra.
- **Unidades.** O saldo do estoque (sempre kg) só aparece ao lado de item pedido em kg; item em outra unidade nunca
  recebe o número em kg, mesmo que exista item de estoque do mesmo insumo.
- **Nome interno.** O indicador de que o estoque pode ser mostrado nesta visão chama `estoque.visivel` (antes
  `disponivel`), para não sugerir o conceito de "estoque disponível", que o core não tem.

## Frescor e sincronização

Chips de frescor: data-base, última atualização de pedido visível, último movimento de estoque (só com carteira
completa) e atualização da fonte. A sincronização do App aparece num chip separado e nunca muda o frescor nem vira
"desatualizado".

## Testes

`comprasCompacto.test.ts` prova, sobre a fixture e contra a saída real do core: paridade com `calcPedido`,
`resumoCompras`, `comparativoOrcadoComprado`, `obra360` e `posicaoEstoque`; emitido ≠ comprometido; recebido ≠ pago;
pedido ≠ lançamento; lançamento em Rascunho sem afirmar rejeição; "criado por" nunca renomeado; nenhuma severidade
nem score; nenhuma necessidade líquida; subconjunto sem vazamento; carteira parcial sem soma própria em R$; estoque
restrito; carteira completa exigindo pedidos visíveis; nenhuma obra e código desconhecido; entrada congelada e
determinismo; ausente ≠ zero; frescor separado de sincronização; tetos; Diretoria e Operação com os mesmos valores;
guardas estáticas (arquivos, sem store, sem rede, sem storage, imports fechados, sem ações de escrita, CSS sob
`.piloto-compra`, fixture fora do runtime, nada fora da pasta referencia o piloto, pilotos existentes intocados).

## Isolamento

- Sem store, Supabase, fetch, XMLHttpRequest, WebSocket, sendBeacon, localStorage, sessionStorage, IndexedDB, service
  worker, subscription ou sincronização; nenhuma ação de aprovar, emitir, receber, cancelar, editar ou salvar. Tudo
  preso por guarda estática nos arquivos do piloto.
- A fixture só é importada pela demo (`mainCompras.tsx`) e pelos testes; a tela e o modelo não a conhecem.
- `piloto-compras.html` não entra no build: o `dist` só empacota `index.html`.
- Estilos sob `.piloto-compra`, só com tokens de `styles.css`; nenhum seletor global nem de outro piloto.
- Nenhum arquivo fora da pasta do piloto referencia o piloto de compras, e os pilotos de Financeiro e Obras não foram
  alterados.

## Limitações

- O seed de produção local tem zero pedidos, insumos, orçamentos e estoque: numa integração futura, o modo local
  mostra "Sem pedidos de compra". A demo usa a fixture.
- Compras não tem severidade canônica; as pendências são fatos neutros até existir uma sugestão de compras no core.
- As unidades do pedido e do estoque são diferentes (estoque sempre em kg); o estoque do insumo só aparece quando o
  item de estoque aponta para o mesmo insumo e o item foi pedido em kg. Nenhuma conversão de unidade é feita.
- Não há data de recebimento gravada no pedido: o frescor usa a última atualização do pedido.

## Dependências da integração futura (não feitas aqui)

- Um ramo `p1 === 'compras'` no `case 'piloto'` do `App.tsx`, com `codigosObraVisiveis` vindo de `obrasVisiveis`, e um
  adaptador `entradaDoApp` no modelo, como na UX-P04.
- Atualizar as guardas que prendem a lista exata de integrações do App (`financeiroCompacto.test.ts` e
  `obrasCompacto.test.ts`); esses arquivos precisam entrar na reserva da integração.
- Remover `mainCompras.tsx` e `piloto-compras.html` e tirar a faixa de teste do runtime, como na UX-P04.
- O PR #2 (Central Wave 03, parado) também toca o `App.tsx`.
- Oportunidades de core, fora desta frente: sugestões para `/compras` com tom canônico; data de recebimento no pedido;
  regra de leitura de pedidos por obra.

## Rollback

Antes da integração: descartar a branch e o worktree. Depois de uma integração futura: reverter o commit de
integração e remover os arquivos do piloto. Nenhum efeito em store, engine ou banco.

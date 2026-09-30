# UX-P07 — Produção compacto (piloto isolado, somente leitura)

**Estado: PILOTO ISOLADO, congelado.** Não está integrado ao App, não tem rota, não aparece em menu, paleta ou tour.
Só roda na demo isolada (`vite dev`) e nos testes. Congelado no commit local "UX-P07: freeze producao compacto
validated pilot", sem push, PR, merge ou deploy.

Frente: aplicar ao domínio de Produção a filosofia validada no Financeiro (UX-P01/P02), no Obras (UX-P03/P04) e no
Compras compacto (UX-P05/P06). Não é uma versão menor da tela Fábrica e montagem: é uma entrada de decisão que
responde o que está sendo produzido, em qual obra, em que etapa, o que está atrasado e onde aprofundar.

- Base: `a002011d151f1b3365102d9c909847f42df2d074` (main após o PR #23). Desde a inspeção (`2491d23`), a main só
  recebeu o PR #23 (Lead Engine LE-3D.2 e catálogo do Mission Control), sem interseção com Produção, pilotos,
  `App.tsx`, store, permissões, tipos ou `styles.css`.
- Branch `feature/ux-p07-producao-compacto`, sem upstream. Worktree `.claude/worktrees/ux-p07-producao`. Porta 5187.
- Demo isolada: `http://127.0.0.1:5187/piloto-producao.html`, só em `vite dev`; o build empacota apenas `index.html`.

## Arquivos (reserva exata)

| Arquivo | Papel |
| --- | --- |
| `src/screens/piloto/producaoCompactoModel.ts` | view-model puro: seleciona, agrupa, ordena e rotula o que o core devolve |
| `src/screens/piloto/ProducaoCompacto.tsx` | tela somente leitura |
| `src/screens/piloto/pilotoProducao.css` | estilos sob `.piloto-producao`, só tokens |
| `src/screens/piloto/producaoCompacto.fixtures.ts` | dados fictícios "PILOTO · DADOS DE TESTE" (demo e testes) |
| `src/screens/piloto/producaoCompacto.test.ts` | provas do modelo e guardas estáticas |
| `src/screens/piloto/mainProducao.tsx` | entrada da demo isolada (só dev) |
| `piloto-producao.html` | página da demo isolada (só dev) |
| `docs/propostas/ux-p07-producao-compacto.md` | este documento |

Nenhum arquivo existente foi alterado: App, store, engine, core, permissões, tipos, `styles.css`, migrations, schema,
os pilotos de Financeiro, Obras e Compras, Inbox, Mission Control, Lead Engine, Comercial/Radar e `CLAUDE.md` estão
intocados. A demo roda com o Vite direto na porta 5187 (como as demos da P05 e da P06), porque `.claude/launch.json`
é versionado e ficou fora da reserva.

## Arquitetura

```
EntradaProducao (fixture na demo e nos testes; numa integração futura, o App)
  → montarProducao (producaoCompactoModel.ts, puro)
      lê: resumoProducao · resumoPeso · resumoProdutividade · calcRomaneio · obra360 · executarChecks
          consumoAco · analisarObra · sugestoesPara
      devolve: ModeloProducao (carregando | erro | vazio | sem-visibilidade | pronto)
  → ProducaoCompacto.tsx (só apresenta: tiles, obras ou ordens, pendências, gaveta de composição)
```

A entrada é um contrato explícito: Dataset, usuário, `codigosObraVisiveis`, fonte (com a sincronização do App), o
instante `agora` e a visão. O modelo não lê relógio, navegador, store nem rede. A tela guarda só estado de interface
(visão, gaveta aberta, "ver todas").

## Fontes canônicas consumidas

| Função | Arquivo | O que o piloto usa |
| --- | --- | --- |
| `resumoProducao(ordens, tipo, dataBase)` | `src/core/obras.ts` | ordens com `calcOrdem` (status, etapa atual, percentual por etapas, `atrasada`, `diasParaNecessidade`), `porEtapa`, emAndamento, atrasadas, concluidas; fabricação e montagem em chamadas separadas |
| `resumoPeso(conjuntos)` | `src/core/materiais.ts` | conjuntos com `calcConjunto` (situação, pesos), pesos liberado, fabricado, expedido e montado com percentuais, `emFabrica`, `emCanteiro`, `porTipo`, `porServico` |
| `resumoProdutividade({ apontamentosEstacao, colaboradores }, { de, ate })` | `src/core/producao.ts` | kg fabricados, expedidos e montados, horas e kg processado por HH por linha contra a meta, `porEstacao` |
| `calcRomaneio(romaneio, conjuntos)` | `src/core/producao.ts` | peso e peças de cada romaneio |
| `obra360(ds, obra, lancs)` | `src/core/engine.ts` | por obra: `fabricacao`, `montagem`, `peso`, `aco`, `servicos`, `servicosAtrasados`, `servicosEmRisco` |
| `executarChecks(ds)` | `src/core/engine.ts` | só ALT-07 e ALT-09, só com a carteira completa |
| `consumoAco(ds, { codigoObra })` | `src/core/estoque.ts` | aço consumido, sobra e líquido da obra, por serviço, em kg |
| `analisarObra(ds, obra360, lancs)` | `src/core/analise.ts` | só os pontos individuais com tema "Produção", com o sinal do core; nunca o semáforo nem o score |
| `sugestoesPara(rota, ds, usuario)` | `src/core/sugestoes.ts` | `ordens-sem-data` (só carteira completa), `obra-<cod>-parados`, `obra-<cod>-datas`, com o tom do core |

O modelo importa apenas essas funções e os tipos (lista fechada presa por teste). Nada é recalculado.

## Classificação final das métricas

| Classe | Métricas |
| --- | --- |
| A, pronta | ordens em andamento, atrasadas e concluídas, fabricação e montagem separadas; por ordem: status, etapa atual, percentual por etapas, data e dias para a necessidade, quantidade na unidade da ordem; peso da lista, liberado, fabricado, expedido e montado com percentuais; peso em fábrica e em canteiro; situação de cada conjunto; kg fabricados, expedidos e montados no período; peso e peças do romaneio; aço consumido líquido da obra |
| B, com contexto | kg processado por HH contra a meta (soma todas as estações da linha: só na composição, nunca em tile); execução física do serviço (mistura fabricação e montagem pelo peso do serviço, aparece só no fato "Em risco"); ALT-09 (soma fabricação e montagem na carteira inteira, é o número do motor); ponto da análise da obra (texto do core, soma fabricação e montagem); percentual da ordem (por etapas, não por kg); agregados de várias obras quando a carteira não é inteira (rótulo "obras visíveis") |
| C, derivável, não implementado | produtividade agregada própria; expedido por serviço; atraso de romaneio; frescor do último apontamento por obra; previsto × realizado por ordem; peso não liberado em kg (exigiria subtração no piloto) |
| D, ausente | bloqueio de ordem, conjunto ou produção; "aguardando material ou projeto"; material disponível, reserva e necessidade; ligação produção → compra; data prevista por conjunto; responsável por conjunto; encarregado ou montador por ordem |

## Decisões aplicadas (reserva aprovada)

1. **Agregação em carteira parcial.** Os agregadores canônicos recebem a coleção já recortada pelas obras visíveis
   (`resumoProducao(ordens filtradas, …)`, `resumoPeso(conjuntos filtrados)`, `resumoProdutividade({ apontamentos
   filtrados, colaboradores }, …)`), que é a assinatura real do core. O piloto não soma nada: o código do modelo não
   usa `reduce`, `+=` nem soma de campos (prova estática). O escopo vem rotulado: "todas as obras" com a carteira
   completa, "somente OB-X" com uma obra, "obras visíveis · N de M" com várias. Nunca "carteira inteira".
2. **Atenção.** Fatos neutros, sem tom, sem score, sem prioridade, na ordem do catálogo: ordem atrasada, serviço com
   situação de prazo "Em risco", peso fabricado ainda não expedido, peso expedido ainda não montado, kg processado por
   HH abaixo da meta, romaneio emitido com entrega não registrada, conjuntos não liberados. Fontes com tom canônico
   preservado 1:1: `ordens-sem-data`, `obra-<cod>-parados`, `obra-<cod>-datas` (tom da sugestão) e ALT-07/ALT-09
   (status do check), estes só com a carteira completa. Pontos de `analisarObra` com tema "Produção" aparecem na
   composição de ordens da obra com o sinal do core. O semáforo geral da obra nunca é usado.
3. **Produtividade.** Fora dos tiles. Aparece só na gaveta "Produtividade" (escopo) e por obra, rotulada "kg processado
   por HH", com a explicação de que soma todas as estações da linha e de que kg processado não é kg produzido. Sem cor,
   sem score, sem média própria, sem custo de mão de obra e sem dado por colaborador. O fato "abaixo da meta" compara
   os dois campos do core e não repete o número fora da composição. Período: o mesmo padrão da tela Fábrica e
   montagem, data-base − 30 dias até a data-base.
4. **Bloqueio.** Não existe conceito canônico de bloqueio de produção. Tarefas (inclusive "Bloqueada") ficam fora do
   UX-P07; o modelo nem lê `tarefas` (prova: uma tarefa Bloqueada ligada a uma ordem não muda nada no modelo).

## Semântica preservada

- fabricação ≠ montagem: nunca somadas no piloto; tiles de ordens têm dois números.
- fabricado ≠ expedido ≠ montado: três pesos distintos do core.
- kg em fábrica ≠ material faltante; kg em canteiro ≠ montagem concluída.
- ordem atrasada ≠ serviço atrasado; ordem sem data ≠ ordem atrasada.
- estoque físico ≠ material disponível.
- percentual da ordem (por etapas) ≠ percentual por kg.
- execução física do serviço (`calcServico.pctExecucao`) ≠ produção da ordem.
- ausente ≠ zero: "sem lista de materiais", "sem ordens", "sem data de necessidade", "responsável não registrado".

Não existe conceito canônico de bloqueio de produção. O piloto não cria score, semáforo próprio, bloqueio, falta de
material, ligação produção → compra, disponibilidade de material, produtividade própria, previsto × realizado,
atraso de romaneio nem kg não liberado. "kg processado por HH abaixo da meta" é só a comparação factual entre dois
campos do core, sem adjetivo nem cor; "romaneio emitido · entrega não registrada" é o status registrado, nunca
"romaneio atrasado".

## Situação

| Visão | Tiles | Fonte |
| --- | --- | --- |
| Diretoria (3) | Peso fabricado (kg, percentual da lista; partes: peso da lista, liberado) · Peso montado (kg, percentual; partes: expedido, em canteiro) · Ordens atrasadas (Fabricação e Montagem em números separados; partes: ordens de cada tipo) | `resumoPeso`, `resumoProducao` |
| Operação (4) | Ordens em andamento (Fabricação e Montagem; partes: concluídas de cada) · Ordens atrasadas · Peso em fábrica (partes: fabricado, expedido) · Peso em canteiro (partes: expedido, montado) | `resumoProducao`, `resumoPeso` |

Os dois conjuntos de tiles são os mesmos objetos: a visão só escolhe quais mostrar. Sem lista de materiais, os tiles
de peso dizem "sem lista de materiais"; sem ordens de um tipo, o número diz "sem ordens". Nunca 0.

## Listas

- **Diretoria:** uma linha por obra visível, com `obra360` daquela obra: peso fabricado e montado (kg e percentual),
  ordens atrasadas de fabricação e de montagem, serviços (total, atrasados, em risco), responsável da obra quando
  registrado (`Obra.responsavel`) e as composições que existem para ela (ordens, peso, conjuntos, produtividade,
  romaneios, aço consumido).
- **Operação:** ordens abertas (Não iniciada ou Em andamento) por data de necessidade, sem data por último, depois
  código. A ordem da lista não é prioridade. Cada linha: obra, serviço, tipo, status, etapa atual, percentual por
  etapas, data e dias para a necessidade, quantidade e unidade, e o responsável registrado na etapa atual
  (`EtapaOrdem.responsavel`) ou "responsável da etapa não registrado". Nenhum encarregado é inferido. O campo
  `prioridade` da ordem não é exibido.

## Composição (gaveta, sob demanda)

`ordem:<id>` (etapas com status, responsável quando registrado, início, conclusão e quantidade concluída) ·
`obra-producao:<cod>` (fabricação e montagem da obra, serviços, responsável da obra, pontos "Produção" da análise) ·
`obra-peso:<cod>` (pesos por marco e por serviço; o core não separa o expedido por serviço) · `conjuntos:<cod>`
(marcas por situação) · `produtividade` e `produtividade:<cod>` · `romaneios:<cod>` · `aco:<cod>` · `peso` e `ordens`
(escopo dos tiles). Cada gaveta traz origem: função, campos, regra e tela de destino que já existe.

## Visibilidade

O piloto recebe `codigosObraVisiveis` pela entrada (fixture na demo e nos testes). Não importa store, não reproduz
`obrasVisiveis` e não lê `usuario.obras`; o papel só aparece no cabeçalho. Ordens, obras, serviços, conjuntos,
apontamentos e romaneios são recortados pelo `codigoObra`. Carteira completa exige todas as obras visíveis e todo
registro de produção numa obra visível; um registro em obra desconhecida torna a carteira incompleta e some da tela.
Globais (ALT-07, ALT-09, `ordens-sem-data`) só com a carteira completa. A posição global de estoque não é exibida.

## Frescor ≠ sincronização

Chips de frescor: data-base, último apontamento de estação nas obras visíveis, última atualização da lista de
materiais e a atualização da fonte. A sincronização do App é um chip separado, espelhado 1:1, e nunca vira
"desatualizado" (prova).

## Relação com outros domínios

- **Obras:** o vínculo ordem → obra → serviço é canônico. Serviço atrasado aparece só como informação da obra;
  ordem atrasada é outro fato. O Obras compacto (em Production) tem um tile "Produção" que soma contagens entre obras e
  tem a cor "warn" herdada da P03; a P07 não repete isso e não altera o piloto de Obras.
- **Compras:** não existe vínculo produção → compra no core. O modelo não lê pedidos (prova com um pedido de compra
  da obra que não muda nada).
- **Estoque:** só `consumoAco` por obra, em kg, com a nota de que estoque físico não é material disponível.

## Testes

`producaoCompacto.test.ts`, 53 provas: fixture identificada e sem nomes reais; cenários provados pela saída do core;
paridade com `calcOrdem`, `resumoProducao` (global e por obra), `calcConjunto`/`resumoPeso`, `resumoProdutividade`
(escopo e por obra), `calcRomaneio`, `consumoAco` e `obra360.aco`; fabricação ≠ montagem; fabricado ≠ expedido ≠
montado; peso ≠ percentual financeiro; em fábrica ≠ faltante; em canteiro ≠ montagem concluída; ordem atrasada ≠
serviço atrasado; ordem sem data ≠ atrasada; ordens abertas sem concluída e cancelada; estoque ≠ disponível; tiles e
fatos sem tom; sugestões, checks e análise 1:1; semáforo e score nunca usados; todo sinal vem de `s.tom`, `c.status`
ou `p.sinal`; rótulos neutros; ordem do catálogo; sem bloqueio inventado; sem ligação com compras; sem nome de
colaborador, custo, motorista ou placa; subconjunto sem vazamento; parcial pelo agregador canônico com rótulo "obras
visíveis"; nenhum somatório no modelo; globais só com a carteira completa; registro órfão; nenhuma obra e código
desconhecido; modelo indiferente ao usuário; estados; entrada congelada; ausente ≠ zero; responsável só quando
registrado; frescor ≠ sync; produtividade fora dos tiles; kg/HH neutro; tetos de tiles, ordens e pendências;
Diretoria e Operação com os mesmos dados; guardas estáticas de imports, efeitos externos, escrita, CSS, fixture e
isolamento dos demais arquivos.

## Gates (30/09/2026)

| Gate | Resultado |
| --- | --- |
| `producaoCompacto.test.ts` | 53 passam |
| `src/screens/piloto` | 193 passam (Financeiro, Obras e Compras inalterados) |
| `npm test` | 122 arquivos, 2435 passam, 8 todo, 0 falhas |
| `npx tsc --noEmit` / `npx eslint src` | 0 / 0 |
| `npm run build` | ok; `dist` só com `index.html`, sem texto do piloto |
| preflight (`pg-preflight-central.mjs --ordem-corrigida`) | 57 migrations, 0 erros |

## Validação na demo (porta 5187)

Diretoria, Operação, gavetas (produtividade, ordens da obra com o ponto da análise, ordem com etapas), pendências
completas com os sinais canônicos, carteira completa, só a obra A, obras A e B, nenhuma visível, sem produção, sem
obras, carregando, erro e tema claro. Console sem erro. Rede só GET em `127.0.0.1:5187` e nas fontes do Google.

## Limitações

- O seed não tem ordens, conjuntos, apontamentos nem romaneios: numa integração em modo local a tela ficará vazia.
- kg/HH é "kg processado"; a meta compara esse número com HH/t de produção completa. É a regra do core, apresentada
  com contexto.
- Não existe conceito canônico de bloqueio de produção.
- Conjuntos não liberados aparecem como contagem de marcas dentro de uma obra, sem kg (evita subtração no piloto).
- A tela Fábrica e montagem e o modo quiosque mostram produtividade e romaneios de obras não visíveis com "Todas as
  obras"; registrado na inspeção, não corrigido aqui.
- A branch remota `fix/teste-piloto-relogio` (outra sessão, sem PR) duplica o fix do PR #22 e deve dar conflito se
  for mesclada.

## Dependências de uma integração futura

- `src/App.tsx`: adaptador `entradaDoApp` (a criar no modelo, como na P06), `lazy` do piloto e ramo
  `p1 === 'producao'` no `case 'piloto'`, com `codigosObraVisiveis` de `obrasVisiveis(usuario, ds.obras)`.
- `src/screens/piloto/financeiroCompacto.test.ts`: a guarda `INTEGRACOES_ESPERADAS` passa de 7 para 9 linhas.
- A fixture sai do runtime; `mainProducao.tsx` e `piloto-producao.html` são removidos, como na P06.

## Rollback

Antes da integração: descartar a branch `feature/ux-p07-producao-compacto` e o worktree. Nenhum efeito em banco,
store, engine ou outro piloto.

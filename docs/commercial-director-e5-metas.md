# CD-D3/E5 — Metas e resultados no Command Center

Última etapa da CD-D3 (meta comercial). Arquivo próprio para não conflitar com o PR #59; depois dele, vira a §19.11 de
`docs/commercial-director-1.0.md`. A rota própria do Diretor Comercial (`#/radar/diretor`) continua sendo do **CD-6**:
aqui só há uma seção no Command Center existente.

## O que a tela faz

Seção **Metas e resultados** no topo do Command Center (`src/screens/radar/MetasResultados.tsx`), que **só apresenta** o
bloco `metaComercial` do `snapshotComercialCD` (CD-1.3, E4) — nenhum indicador é calculado na tela:

- **Visão principal**: mês comercial (seletor), receita ganha líquida (`meta.realizado`) "de" meta vigente, barra de
  atingimento, falta para a meta ou excedente, negócios ganhos (com a receita ganha confirmada), ganhos sem valor
  confirmado e estornos (com o valor). Um selo diz o estado do mês.
- **Detalhes sob demanda** (`<details>`): alertas do motor, versões da meta do mês (só leitura), retificações por
  complemento, eventos desconsiderados, fontes e versão das regras.
- **Instante de referência visível**: "Retrato de dd/mm/aaaa hh:mm (horário de São Paulo)", sempre no fuso comercial.

## Referência temporal

O Command Center captura **um** instante (`useState(() => new Date().toISOString())`) e passa o MESMO `agoraIso` e o
`mesComercial` escolhido à única chamada de `snapshotComercialCD` da tela — nenhuma parte do retrato tem outro horário.
O instante só muda em **Atualizar** e depois de salvar uma meta (para a versão nova entrar no retrato). O seletor mostra
3 meses à frente e 12 para trás a partir do mês do instante em São Paulo (`mesesDoSeletor`). As métricas operacionais
seguem com o `hoje` de antes (data-base); só o bloco de meta usa o instante.

## Estados (modelo puro `src/screens/radar/metaResultadoVisao.ts`)

`estadoTelaMeta` decide pelos ESTADOS das medidas e pelo `metaVigente`, sem conta, nesta ordem: sem instante · metas
indisponíveis · livro indisponível · mês futuro · sem meta · meta retirada · meta com problema · ganhos sem valor
confirmado · meta vigente e nenhuma venda · parcial · atingida. Indisponível aparece como **"—" com o motivo** da medida
(uma vez, no destaque; a faixa só repete motivo diferente). Zero só quando o livro foi carregado e está vazio.

## Gestão da meta

- Só pela ação canônica `actions.definirMetaComercialRadar(mes, valor, motivo)` (E2), chamada por
  `actions.definirMetaComercialConfirmada` (`src/data/metaConfirmada.ts`), que **só diz "salvo" depois do banco**:
  1. não começa se já houver alterações não confirmadas (uma falha descartaria trabalho de outra tela);
  2. chama a ação canônica (permissão `radar_config` = Administrador e Diretoria; mês corrente ou futuro em São Paulo;
     valor positivo com até 2 casas; motivo de 3 a 500; cada mudança é versão nova; retirar exige meta vigente; mesmo
     valor não versiona);
  3. no remoto, espera a sincronização (RPC `radar_definir_meta_comercial`, que repete as guardas e audita), **recarrega
     do banco** e devolve a versão persistida (número do banco), conferindo valor e motivo. Recusa do banco recarrega
     (a versão local some) e mostra o erro; sem rede, "pendente — ainda NÃO confirmada".
- A tela (`edicaoMeta`) só esconde o que não passaria: demais papéis do Radar veem em modo leitura ("Somente
  Administrador e Diretoria definem metas."), mês encerrado não edita, retirar só com meta vigente. Nenhuma versão
  anterior é editável; não há escrita direta na tabela nem RPC paralela.
- O formulário mostra a validação do motor E1 (`motivosRecusaNovaMeta`) junto do campo e fica em "Confirmando no
  banco…" até a resposta.

## Provas

| Prova | Resultado |
|---|---|
| `src/screens/radar/metaResultadoVisao.test.ts` — 11 estados, paridade tela × snapshot em todos, "—" com motivo, instante e seletor em São Paulo (virada de mês e ano), um instante por retrato, permissões, render estático dos estados, guardas (a tela não calcula nem escreve no banco) | 28 ok |
| `src/data/metaConfirmada.test.ts` — confirmação do banco (sucesso, recusa, sem rede, recarga divergente, retirada, sincronização pendente/em andamento, mesmo valor, modo local) e o caminho real do store: criar v1, revisar v2, mesmo valor, retirar v3, recusas sem mudança, papéis | 14 ok |
| Suíte completa, type-check, lint e build | ok |
| Evidência visual (componente real com o CSS do app, 12 quadros: estados, detalhes, iPad, celular, formulário) | anexada ao PR |

## Limitações

- O teste de confirmação usa um banco simulado nas portas; a RPC real e a recarga já são provadas pelo
  `smoke:meta-comercial` (E2) e pela integração da E3. A primeira confirmação com o banco de produção acontece na
  validação depois da publicação.
- A evidência visual é o componente real renderizado com o CSS do app (estados com dados fictícios); o fluxo de clicar
  em Salvar no navegador fica para a validação pós-publicação, com login do Augusto.

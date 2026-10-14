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
  3. no remoto, espera a sincronização (RPC `radar_definir_meta_comercial`, que repete as guardas e audita) e **confere
     nas versões persistidas do mês** (leitura direta `lerMetasComerciaisDoMes`, RLS do usuário) — o status da fila de
     sincronização é GLOBAL e nunca é usado como prova. Resultados:
     - **confirmada**: a versão pedida (valor e motivo) está entre as versões gravadas depois do começo; devolve a do
       banco (número do banco). Se outra operação da fila falhou, a meta continua confirmada, com aviso, e o app NÃO
       recarrega (não apaga a outra alteração, que segue para "Tentar de novo"); se outra sessão mudou depois, avisa o
       que vale agora;
     - **não gravada**: a leitura mostra que a versão não existe (comprovado), com o erro da fila quando houver;
     - **desatualizada**: o cache dizia "mesmo valor da vigente" (a E2 não cria versão), mas o banco tem outra meta
       vigente (outra sessão mudou ou retirou): nada é dado como confirmado, o app recarrega e pede revisão. Com o mesmo
       valor também no banco, confirma sem versão nova, com a versão do banco;
     - **pendente**: sem rede, guardada no aparelho, ainda NÃO confirmada;
     - **indeterminado**: não deu para ler o banco depois de enviar — pede recarga e conferência, nunca "nada foi gravado".
     A recarga completa só acontece com a fila "ok".
- A tela (`edicaoMeta`) só esconde o que não passaria: demais papéis do Radar veem em modo leitura ("Somente
  Administrador e Diretoria definem metas."), mês encerrado não edita, retirar só com meta vigente. Nenhuma versão
  anterior é editável; não há escrita direta na tabela nem RPC paralela.
- O formulário mostra a validação do motor E1 (`motivosRecusaNovaMeta`) junto do campo e fica em "Confirmando no
  banco…" até a resposta.

## Provas

| Prova | Resultado |
|---|---|
| `src/screens/radar/metaResultadoVisao.test.ts` — 11 estados, paridade tela × snapshot em todos, "—" com motivo, instante e seletor em São Paulo (virada de mês e ano), um instante por retrato, permissões, render estático dos estados, guardas (a tela não calcula nem escreve no banco) | 28 ok |
| `src/data/metaConfirmada.test.ts` — banco simulado que separa a fila global das versões persistidas: meta gravada com outra operação falhando depois (confirmada, sem recarga), fila "ok" sem a meta (não gravada), fila em erro sem a meta (não gravada), sem leitura (indeterminado), sem rede (pendente), outra sessão antes/depois, retirada; mesmo valor conferido no banco e cache desatualizado por outra sessão (alteração e retirada); pré-condições; e o caminho real do store (v1, v2, mesmo valor, v3, recusas, papéis) | 20 ok |
| Suíte completa, type-check, lint e build | ok |
| Evidência visual (componente real com o CSS do app, 12 quadros: estados, detalhes, iPad, celular, formulário) | anexada ao PR |

## Idempotência por intenção (E5-REL-01, migration 0074)

Duas janelas sobravam depois do PR #71 original: a RPC fazia COMMIT e o cliente perdia a resposta (rede), ou o app
fechava antes de registrar o progresso. A defesa definitiva é no banco:

- **Identificador estável por intenção**: a ação canônica gera `intencao` (UUID) e `versaoBase` (a versão vigente em que
  a decisão se apoiou) ANTES do primeiro envio; `persistirMetas` chama `radar_definir_meta_comercial_intencao` (0074),
  que, sob trava da intenção: devolve o **resultado original** se a intenção já foi executada (sem versão nova, mesmo que
  outra sessão tenha mudado a meta depois); **recusa** o mesmo id com conteúdo diferente; para intenção nova exige
  **versão base = vigente** (decisão sobre dado desatualizado não substitui em silêncio uma posterior) e aplica pela RPC
  da 0068 (papel, mês, valor, motivo, versão, auditoria). Registro `radar_commercial_goal_intent` imutável, só leitura
  para a API. A 0068 e a 0070 não mudaram.
- **Diário local antes do envio** (`offline.ts`, chave `intencoesMeta`): a intenção é gravada no IndexedDB antes de
  ir ao banco e sai dele quando o banco a aceita. Na reabertura, `carregarComPendentes` reaplica o diário pela RPC
  idempotente (nunca duplica); intenção recusada (versão velha, conteúdo diferente) sai do diário e vira aviso. As
  pendências dos outros módulos continuam no mecanismo de sempre.
- `definirMetaConfirmada` também compara a versão do banco com a do app antes de chamar a ação (desatualizada = nem envia).

Provas: `npm run smoke:meta-intencao` (PGlite, fila inteira até a 0074, no Quality Gate, 24 ok); gate em
**PostgreSQL 17.6 real** descartável (ordem de produção …0073 → 0070 → 0074; mesma intenção em duas sessões 20/20,
resposta perdida + outra sessão, conteúdo diferente concorrente, pré-condição concorrente 10/10, rajadas de 8 sessões
5/5 + 5/5, integridade, zero deadlock: 12 ok); `src/data/meta.intencao.store.test.ts` (fila real do store: diário antes do
envio, resposta perdida + outra sessão, reabertura, app fechado antes/depois da RPC, intenção velha recusada, nova
decisão, falha posterior).

## Limitações

- **Corrigido antes de publicar (bloqueador de release da E5)**: `persistirRemoto` grava na ordem escrita genérica →
  `persistirRadar` (… `persistirMetas`, `persistirDesfechos`) → Inbox → auditoria, e a fila só avançava a base
  sincronizada quando a rodada inteira dava certo. Com a meta aceita e uma operação POSTERIOR falhando, "Tentar de novo"
  e a pendência offline reenviavam a mesma intenção — e, com outra sessão tendo mudado a meta no meio, a RPC criava uma
  versão nova com o valor ANTIGO. Agora `persistirMetas` avisa `aoGravarMeta` logo depois de cada RPC aceita;
  `sincronizar` e `carregarComPendentes` põem a versão na base (`comMetaGravada`: só a lista de metas muda) e a
  pendência offline é regravada com ela. A retomada não a reenvia; as alterações dos outros módulos continuam pendentes.
  Provas: `src/data/radar.meta.reenvio.test.ts` (banco simulado com a regra da RPC: o defeito reproduzido e a correção)
  e `src/data/meta.reenvio.store.test.ts` (fila real do store: Tentar de novo, várias retomadas, meta nova depois da
  falha, pendência offline e reabertura) — os 5 testes do store falham no código anterior.

- O teste de confirmação usa um banco simulado nas portas; a RPC real e a recarga já são provadas pelo
  `smoke:meta-comercial` (E2) e pela integração da E3. A primeira confirmação com o banco de produção acontece na
  validação depois da publicação.
- A evidência visual é o componente real renderizado com o CSS do app (estados com dados fictícios); o fluxo de clicar
  em Salvar no navegador fica para a validação pós-publicação, com login do Augusto.

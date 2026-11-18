# P1 — isolamento de produção e preview (formulário do site → CRM)

Estado em 18/11/2026: **código pronto em branch, nada aplicado em produção.** Cada passo marcado VERMELHO só roda
com autorização específica da Direção. Executor: `scripts/p1-isolamento.mts`. Decisões: `src/core/radar/formularioP1.ts`.

## 1. O risco, medido

| Fato | Fonte |
| --- | --- |
| Os formulários do Netlify são do **site inteiro**: submissão feita num preview entra na mesma lista da produção | V-A3 (E-1) e guia de suporte do Netlify |
| O evento `submission-created` dessa submissão roda no deploy **publicado de produção**, com contexto de produção | V-A3 (E-2) |
| Nada confiável no evento distingue a origem: só `data.referrer`, que vem do navegador | V-A3 (E-3) |
| O último deploy de **qualquer** contexto atualiza a definição dos formulários do site | guia de suporte do Netlify |
| **15 deploy previews** prontos ainda servem os formulários com os nomes de produção (permalink até 90 dias, o mais antigo de 29/10) | inventário 18/11 |
| Deploy previews **ligados** no projeto `eiff` (`skip_prs` nulo), sem senha | inventário 18/11 |
| `EIFF_FORM_SECRET` com valor em **dev, branch-deploy, deploy-preview, production, dev-server** no site **e** no CRM | inventário 18/11 |
| Cada deploy guarda as variáveis da época; mudar a variável só vale para deploys novos | documentação do Netlify |
| `CONTEXT` é variável de **build**; em runtime de função só `URL`, `SITE_NAME`, `SITE_ID` são documentadas | documentação do Netlify |
| O 2º argumento `context` da Functions API (`deploy.context`, `deploy.published`, `site.id`) é documentado; que ele chegue **preenchido em função de evento** não está escrito | documentação + tipos `@netlify/serverless-functions-api` |

Conclusão: o risco é de **origem**, não de credencial. Uma guarda dentro da função não resolve sozinha, porque
para ela as duas submissões são idênticas. É preciso que **nenhum deploy não produtivo tenha formulário**.

## 2. A solução, em camadas

| Camada | O que faz | Onde | Classe |
| --- | --- | --- | --- |
| L1 build | fora de `CONTEXT=production` (inclusive ausente) o HTML sai **sem formulário**: sem `data-netlify`, sem honeypot, sem `form-name`, com aviso visível. Em produção confere os dois formulários e falha o build se faltarem | eiff-site `scripts/formularios-por-contexto.mjs` | código (PR) |
| L2 função | só encaminha com contexto da plataforma de **produção publicada deste site** e só `iniciar-projeto`/`simular-galpao`; sem contexto, **não encaminha** (fail-closed) | eiff-site `submission-created.mts` | código (PR) |
| L3 CRM | aceita o segredo em **duas vagas** (`EIFF_FORM_SECRET`, `EIFF_FORM_SECRET_B`) para trocar sem recusar lead; log diz qual vaga conferiu, nunca o valor | eiff-control `formularioServidor.ts` | código (PR) |
| L4 segredo | valor novo só em `production`, escopo functions, nas duas pontas; valores não produtivos do site apagados; depois a vaga antiga do CRM é apagada → **todo deploy antigo perde a autorização** | `p1-isolamento.mts troca-*` | VERMELHO |
| L5 previews antigos | apagar os 15 deploy previews (permalink passa a 404) | `p1-isolamento.mts limpar-previews` | VERMELHO |
| L6 previews novos | `skip_prs = true` no projeto `eiff` (branch deploys já são só `main`) | `p1-isolamento.mts desligar-previews` | VERMELHO |
| L7 homologação | testes de formulário só em projeto Netlify separado, sem credencial do CRM | decisão já registrada no desenho B + D + C (P1, H1) | VERMELHO (criar projeto) |

### G — desabilitar formulários nos previews × projeto separado de staging

| Critério | Formulários desativados no build (L1) | Projeto separado (L7) |
| --- | --- | --- |
| Impede submissão de preview chegar ao CRM | sim, para deploys **novos**; os antigos dependem de L5 | sim, se o projeto de produção também não tiver preview (L6) |
| Protege a definição dos formulários de produção | sim (preview sem formulário não declara formulário) — **a confirmar em H-1** | sim (formulários de outro projeto) |
| Permite testar o envio de formulário | não | sim, com segredo fictício |
| Custo/operação | nenhum | um projeto a mais; deploy de produção dele custa créditos |
| Depende de disciplina | não (automático pelo contexto) | não |

**Recomendação:** as duas, com papéis distintos. **L6 + L5 + L1** encerram o risco no projeto de produção
(sem preview novo, sem preview antigo, e se alguém religar os previews eles nascem sem formulário). **L7** é
onde se testa formulário. L1 sozinho não basta (previews antigos); L7 sozinho não basta (o projeto de produção
continuaria gerando previews com formulário).

## 3. Sequência de implantação (cada linha VERMELHA é uma autorização)

| # | Passo | Prova antes de seguir | Lead durante o passo |
| --- | --- | --- | --- |
| 0 | **H-0/H-1 em projeto descartável** (ver §5): contexto chega à função de evento; preview sem formulário não apaga o formulário de produção; envio pelo preview desativado não vira submissão | as três provas | não toca produção |
| 1 | Mesclar e publicar o CRM com as duas vagas (código só) | `/api/formulario-site` 405 no GET; nenhum 401 novo | sem mudança (só a vaga a existe) |
| 2 | `troca-preparar`: vaga b no CRM e valor novo no site, só production; valores não produtivos do site apagados. **A trava do site segue ligada e nada do site é publicado até o passo 3 terminar** (senão o valor novo dá 401) | inventário mostra b em production e o site só com production | sem mudança: os deploys no ar ainda usam o valor antigo |
| 3 | Publicar o CRM de novo (passa a ler a vaga b) | inventário + 405 | CRM aceita a e b |
| 4 | Mesclar e publicar o site P1 (L1 + L2, build novo lê o valor novo) | smoke: `form-name` no ar nas duas páginas; formulários registrados; função presente | site manda b; CRM aceita |
| 5 | Esperar o **primeiro lead real** depois do passo 4 aparecer no Inbox e ler no log da borda do CRM (painel do Netlify) a linha `"etapa":"autenticado","chave":"b"` desse lead; conferir também que não há `"outcome":"bloqueado"` no log da função do site | lead no Inbox + `chave` da vaga nova | — |
| 6 | `limpar-previews` + `desligar-previews` | inventário: 0 não produtivos; `skip_prs=true` | sem efeito em produção |
| 7 | `troca-concluir --chave-observada b` (as vagas antiga e nova são derivadas do estado, nunca de parâmetro) e publicar o CRM | inventário: só b; deploys antigos passam a 401 | site atual (b) segue entrando |

Se o passo 5 demorar, nada se perde: até o passo 7 o CRM aceita as duas vagas.

## 4. Recuperação

| Falha | Ação |
| --- | --- |
| passo 2 falhou depois de criar a vaga b | `troca-desfazer` (apaga a b; site intocado) |
| passo 4: formulário some em produção | restaurar o deploy anterior do site (ainda tem valor antigo, aceito até o passo 7) |
| passo 4: L2 bloqueia tudo (`contexto_ausente` no log) | restaurar o deploy anterior; o lead fica no painel de formulários e entra pela conferência C. É exatamente o que H-0 previne |
| depois do passo 7 | **restaurar deploy antigo do site deixa de funcionar** (valor antigo recusado). Retorno passa a ser **novo build** do commit anterior (lê o valor atual). Os pontos de retorno anotados hoje (`6af758cc`, `6af3b1ba`, `6af32e64`) ficam inertes para o CRM |
| CRM fora do ar | inalterado: o site tenta 3 vezes; o lead fica no painel; conferência C |
| reconciliação manual depois do passo 7 | `scripts/formulario-reconciliar.mts` faz POST na borda com `EIFF_FORM_SECRET` local, e **ninguém conhece o valor novo**: esse caminho manual deixa de autenticar. A recuperação passa a ser a conferência C (desenho B + D + C, CSV no CRM, sem segredo) ou a função agendada, que grava direto por `gravarSubmissao` e não usa o segredo |
| executor falhou no meio | `api()` sai na primeira falha sem imprimir detalhe; `inventario` mostra o estado e `troca-desfazer` recupera o passo 1 |

## 5. Provas em ambiente descartável (antes do passo 1)

Projeto Netlify descartável, segredo fictício, endpoint fictício próprio (nunca o CRM), dados fictícios:
- **H-0**: a função de evento registra só `deploy.context`, `deploy.published` e se `site.id` existe, para uma submissão no deploy de produção do descartável. Inclui: uma chamada HTTP direta, de fora, a `/.netlify/functions/submission-created` do deploy publicado é recusada pela plataforma (assinatura do evento) e não chega ao encaminhador.
- **H-1**: depois de um deploy preview sem formulário, o formulário de produção do descartável continua listado, com os mesmos campos, e uma submissão no endereço de produção é aceita.
- **H-2**: o envio pela tela do preview desativado não cria submissão (contagem do formulário não muda).

Custo estimado: dois deploys de produção do descartável (créditos do plano) e uma ou duas horas de agente. Exclusão do projeto ao fim, com prova.

## 6. Registros que já existem (F) e a conferência C

- Hoje: `simular-galpao` 11 submissões, `iniciar-projeto` 4, nenhum formulário com outro nome. As submissões de ensaio já têm lista de exclusão por id (`docs/formulario-exclusao-ensaios` / PR #88).
- Depois de L1, um preview não cria formulário, então nada novo de preview aparece na lista. Se L1 falhar e um preview declarar formulário, ele aparece com o mesmo nome — por isso a C continua excluindo **por id registrado**, nunca por conteúdo.
- Submissões feitas nos 15 previews antigos até a limpeza (passo 6) são indistinguíveis das de produção na lista; nenhum ensaio está autorizado nesses endereços.

## 7. Achado fora do formulário (para a Frente B)

No projeto do CRM, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VIBE_API_KEY`, `GITHUB_READ_TOKEN` e `GOOGLE_OAUTH_*`
têm valor também em **deploy-preview** e **branch-deploy**: um deploy preview do CRM tem a chave de serviço do banco
de produção. Registrado na issue #99. Não alterado (autoridade da Frente B).

## 8. Limites declarados

- L2 depende de a plataforma passar `context` à função de evento; sem H-0 não se publica o passo 4.
- O valor novo passa como argumento ao processo da CLI do Netlify durante a chamada (segundos, nesta máquina).
- Quem enviar à mão um POST com `form-name` de produção para qualquer endereço do site cria uma submissão — isso já é verdade para o próprio site de produção e não é isolamento de ambiente.
- Publicar `dist` gerado fora do build do Git sai sem formulário (L1 fail-closed). Por isso o smoke de **toda** publicação do site (não só a do P1) confere `form-name` no ar nas duas páginas e os dois formulários registrados — está na política do site (#98, rito passo 7).
- Um push novo no eiff-site#11 gera outro deploy preview sem formulário no projeto `eiff`. O primeiro (`6afdc87a`, 18/11) já foi construído e os formulários de produção ficaram intactos (24 e 10 campos, mesmas contagens): metade do H-1 provada no ambiente real, sem envio. O `[skip netlify]` não pulou o build.

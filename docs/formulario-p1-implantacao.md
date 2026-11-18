# P1 — procedimento coordenado de implantação (janela única)

Complementa `docs/formulario-p1-isolamento.md` (o plano e o porquê). Este documento é o **como**: a ordem exata
para a janela de implantação, com o que se confere em cada passo e como voltar. **Nada aqui foi executado.**
Cada passo VERMELHO só roda com a autorização correspondente da Direção.

## 0. Estado de partida (conferido em 18/11/2026, depois dos merges)

| Projeto | Publicado (no ar) | Construído e NÃO publicado | Diferença publicado → `main` |
| --- | --- | --- | --- |
| CRM `eiff-control` | `6afda676` = 148c7ab, travado | `6afdd7da` = 213887d | **#96** (S3/0077: só migration, docs, scripts, CI — **nenhum arquivo de runtime**; migration já aplicada à parte) e **#101** (P1: borda aceita as vagas a e b; com a b ausente, comportamento idêntico ao de hoje). Ambos revisados de forma independente |
| Site `eiff` | `6afda685` = 44c9b40, travado | `6afdd7f5` = f00893a | **#11** (P1: preview sem formulário, guarda da função). Revisado; H-0/H-1/H-2 aprovados em projeto descartável |

Formulários de produção: `iniciar-projeto` (10 campos, 4 submissões) e `simular-galpao` (24 campos, 11). `form-name`
no ar nas duas páginas e no build `6afdd7f5`.

**Os builds `6afdd7da` e `6afdd7f5` NÃO serão publicados.** Foram feitos antes da troca do segredo, e cada deploy
guarda as variáveis da época. A janela gera builds novos depois da troca.

## 1. Risco que continua até o passo J1

Como a H-2 comprovou, um POST montado à mão com `form-name` contra qualquer URL de preview do projeto `eiff` é aceito
e encaminhado ao CRM como lead. A aprovação da H-2 vale para a tela, **não** é isolamento completo. Hoje há 15 previews
prontos, e cada novo PR do site cria outro. Por isso a janela **começa** fechando os previews.

## 2. A janela

| # | Passo | Classe / autorização | Comando (agente) | Conferência para seguir | Leads durante o passo |
| --- | --- | --- | --- | --- | --- |
| J0 | Pré-checagem: as duas travas ligadas, publicados = os da tabela §0, formulários com 10/24 campos, `inventario` sem surpresa | leitura | `npx vite-node scripts/p1-isolamento.mts -- inventario` | igual ao §0; senão PARA | inalterado |
| J1 | **Fechar os previews**: desligar previews novos (`skip_prs=true`) e apagar os 15 previews prontos | VERMELHO: «desligamento dos previews» + «exclusão dos previews» | `-- desligar-previews --executar --confirmar P1_DESLIGAR_PREVIEWS` e `-- limpar-previews --executar --confirmar P1_LIMPAR_PREVIEWS` | `inventario`: 0 não produtivos, `skip_prs=true`, `build_settings` sem outra mudança; permalinks `deploy-preview-N--eiff` = 404; formulários de produção iguais | inalterado (produção não é tocada) |
| J2 | **Troca do segredo, parte 1**: vaga b no CRM (só production), valor novo no site (só production), valores não produtivos do site apagados | VERMELHO: «rotação de segredos» | `-- troca-preparar --executar --confirmar P1_TROCA_PREPARAR` | `inventario`: CRM com a e b, b só production; site só production | inalterado: os deploys no ar usam o valor antigo, aceito pela vaga a |
| J3 | **CRM**: construir de novo a `main` (agora com a vaga b no ambiente) e publicar esse build | VERMELHO: `PRODUCTION AUTORIZADA` (CRM) | `netlify api createSiteBuild` no CRM; esperar `ready`; anotar o publicado como retorno; `restoreSiteDeploy` do build novo; conferir `locked` | `/api/formulario-site` = 405 no GET; deploy publicado = build novo, travado | CRM aceita a e b |
| J4 | **Site**: construir de novo a `main` (lê o valor novo) e publicar esse build | VERMELHO: `PRODUCTION AUTORIZADA` (site) | `createSiteBuild` no site; conferir no permalink do build `form-name` nas duas páginas; anotar o retorno; `restoreSiteDeploy`; `locked` | smoke sem envio: 200 nas páginas, `form-name` no ar, formulários 10/24, lista de funções = `submission-created` | o site passa a mandar a vaga b; CRM aceita |
| J5 | **Prova com lead real**: no primeiro lead real depois de J4, ler no painel do Netlify (CLI não mostra conteúdo de log) o log da borda do CRM com `"etapa":"autenticado","chave":"b"`, e o log da função do site sem `"outcome":"bloqueado"` e sem `TODO_LEAD_BLOQUEADO`. O lead aparece no Inbox | leitura | — | os três sinais | — |
| J6 | **Troca do segredo, parte 2**: apagar a vaga a do CRM e publicar um build novo do CRM. Daí em diante todo deploy antigo do site é recusado (401) | VERMELHO; **só com a conferência C ou a reconciliação agendada LIGADA** (o script recusa sem `--recuperacao-ativa`) | `-- troca-concluir --chave-observada b --recuperacao-ativa <conferencia-c\|agendada> --executar --confirmar P1_TROCA_CONCLUIR`, depois build e publicação do CRM | `inventario`: só a vaga b | site atual (b) segue entrando |

J1 a J5 podem rodar na mesma janela, numa sessão só. A J6 fica **para depois**, quando um caminho de recuperação
estiver ligado em produção. Até a J6 as duas vagas valem, o que é seguro: depois de J1 nenhum deploy não produtivo do
site existe, e os deploys antigos de produção servem as mesmas páginas da produção.

## 3. Volta, por passo

| Passo | Se falhar | Volta |
| --- | --- | --- |
| J1 | algo além de `skip_prs` mudou em `build_settings` | o script para e imprime os valores anteriores; restaurar esses campos. A exclusão de previews não tem volta, nem precisa: são artefatos de teste |
| J2 | falhou depois de criar a vaga b | `troca-desfazer --site-sem-valor-novo-publicado --vaga b --executar --confirmar P1_TROCA_DESFAZER` |
| J3 | 405 não responde ou erro | restaurar o deploy anotado (`6afda676` ou o anotado em J3). A vaga b só existe no ambiente, sem efeito |
| J4 | formulário sumiu, função ausente, `TODO_LEAD_BLOQUEADO` no log | restaurar o deploy anotado do site (`6afda685`), que tem o valor antigo, **ainda aceito até a J6**. Lead que tenha ficado só no painel entra pela conferência C |
| J6 | — | depois da J6, restaurar um deploy antigo do site **não serve mais** de retorno (valor antigo recusado). Volta = build novo do commit anterior |

## 4. Recebimento de leads na janela

- Em nenhum passo de J0 a J6 o CRM deixa de aceitar o segredo que o site no ar manda. A janela inteira é compatível com as duas vagas.
- O único ponto em que um erro pararia leads é a J4. Se a guarda da função falhasse em produção, ela registraria `TODO_LEAD_BLOQUEADO`. A H-0 mostrou que o contexto chega, e a volta é imediata, porque o deploy anterior continua aceito.
- Durante a janela não se envia formulário fictício no projeto comercial. A prova de entrega é o primeiro lead real (J5).

## 5. Autorizações a pedir, nesta ordem

1. **J1**: desligar previews novos e excluir os 15 previews.
2. **J2**: rotação do segredo (parte 1).
3. **J3**: `PRODUCTION AUTORIZADA` para o CRM.
4. **J4**: `PRODUCTION AUTORIZADA` para o site.
5. **J6**: apagar a vaga antiga, junto com a decisão de ligar a conferência C ou a reconciliação agendada. Fica separada e posterior.

A proteção da `main` do site (ruleset pronto no #98) segue como pendência administrativa e não faz parte desta janela.

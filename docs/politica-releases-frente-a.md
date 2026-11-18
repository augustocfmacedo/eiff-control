# Política de releases da Frente A — proposta de adequação

**Status: PROPOSTA. Não está em vigor.** Foi preparada por pedido da Direção (diretriz de autonomia operacional da
Frente A, item 4) e só passa a valer depois de aprovada. Até lá vale a regra atual: merge em `main` exige a frase
`MERGE AUTORIZADO` e publicação exige `PRODUCTION AUTORIZADA`, cada uma por mudança.

Escopo: site comercial (`eiff-site`, projeto Netlify `eiff`), formulários e captação, integração site → CRM do lado
da Frente A. O CRM (estruturas, migrations, regras, RLS) é autoridade da Frente B. O SIM-04 estrutural fica fora.

## 1. Estado atual (conferido em 18/11/2026)

| Item | `eiff-control` (CRM) | `eiff-site` |
| --- | --- | --- |
| Proteção da `main` | ruleset `Protecao da main`: PR + `EIFF Quality Gate` + branch atualizada | **nenhuma** |
| Gate antes do merge | `EIFF Quality Gate` (testes, lint, build, smokes em PostgreSQL) | **nenhum** (os testes só rodavam no build do Netlify, depois do merge); proposto no PR eiff-site#10 |
| Publicação automática | travada (`published_deploy.locked = true`): merge constrói e não publica | travada da mesma forma |
| Publicado | `e55b3d6` = ponta da `main` | `9e71865` = ponta da `main` |
| Deploy preview | ligado | **ligado**, e a submissão feita num preview chega ao CRM pela função de produção (achado E-2 da V-A3) |
| Identidade de quem mescla e publica | conta pessoal da Direção (CLI `gh` e `netlify` logadas) | idem |

A consequência é que hoje **todo merge e toda publicação são VERMELHOS** na prática. Não existe identidade de agente
separada da conta da Direção, e o site não tem gate antes do merge.

## 2. Classes de risco

**VERDE.** Os agentes mesclam e publicam sozinhos, sob as condições da seção 3.
- Documentação.
- Testes novos ou mais rigorosos.
- Texto, imagem e estilo de páginas do site que **não** contêm formulário.
- Workflows de CI somente leitura.

**AMARELO.** Os agentes mesclam. A publicação exige `PRODUCTION AUTORIZADA`.
- Páginas com formulário, sem mudar o nome do formulário nem o nome dos campos.
- Código do simulador.
- Texto que o CRM mostra ao comercial a partir da submissão (ex.: `resumoParaOInbox`), sem tocar no canônico nem na impressão.
- Dependências do site.

**VERMELHO.** Autorização específica para merge e para publicação, como hoje.
- A função de evento (`submission-created.mts`) e a pasta `netlify/functions`.
- `netlify.toml`.
- Nomes de formulário e de campo (o contrato com o CRM).
- Variáveis de ambiente, segredos e credenciais.
- Configuração do Netlify: previews, trava, webhooks, notificações.
- Proteção de branch e rulesets.
- Migrations, RLS e permissões.
- O canônico e a impressão do Lead Engine.
- Reconciliação e monitor (B + D + C, PR #92) enquanto estiverem congelados.
- Qualquer coisa que envie formulário, e-mail ou mensagem.
- Qualquer mudança cujo diff toque mais de uma classe: vale a classe mais alta.

A classe é do **diff inteiro entre o que está publicado e o que vai ser publicado**, não do PR. Um deploy do CRM
publica tudo o que já foi mesclado na `main`, inclusive trabalho de outras frentes ainda não liberado. Se o publicado
e a ponta da `main` divergem por qualquer coisa que não seja VERDE, a publicação deixa de ser VERDE.

## 3. Condições para o agente mesclar e publicar (VERDE)

Para mesclar:
1. A classe está declarada no corpo do PR, com a lista de arquivos e a regra que a justifica. Qualquer arquivo de lista VERMELHA rebaixa a mudança automaticamente; a conferência é feita por script, não por leitura.
2. O Quality Gate está verde **no SHA exato da cabeça do PR**, com a branch atualizada com a `main`.
3. A revisão independente foi feita por um agente que não escreveu o código, recebendo o diff e não a conclusão de quem escreveu. O parecer fica registrado no PR. Achado não resolvido bloqueia.
4. Antes do merge, a trava de publicação foi conferida e está ligada (`published_deploy.locked = true`). Se estiver desligada, o agente para e reporta, como no incidente de 30/09/2026.

Para publicar:
5. O diff entre o commit publicado e o candidato contém só mudanças VERDES.
6. Antes de publicar, o deploy em produção é anotado como ponto de retorno.
7. A publicação usa o deploy **já construído** daquele commit (restaurar o deploy). Não há segundo deploy, e a trava continua ligada.
8. Depois de publicar, roda um smoke não destrutivo: as páginas principais respondem 200, o `deploy id` publicado é o esperado, a lista de funções não mudou e os formulários continuam no HTML. **Nenhum formulário é enviado.**
9. Se o smoke falhar, o agente restaura o ponto de retorno anotado (mecanismo já usado em produção: `restoreSiteDeploy`) e reporta como RISCO CRÍTICO.

## 4. O que precisa de decisão da Direção para esta política valer

1. **Aprovar a política.** A aprovação substitui, só para mudanças VERDES da Frente A, a exigência da frase por mudança. AMARELO e VERMELHO continuam como hoje.
2. **Identidade dos agentes.** Hoje mesclar ou publicar significa usar a conta pessoal da Direção, o que a diretriz proíbe. É preciso decidir entre:
   - um usuário-máquina no GitHub, com permissão de escrita só nos dois repositórios, e um token Netlify de um membro de time com papel restrito;
   - manter a conta atual, e então só AMARELO e VERMELHO existem.

   Criar essas credenciais é ato da Direção. Os agentes não criam credencial.
3. **Proteção da `main` do site**: ruleset equivalente ao do CRM, exigindo o **EIFF Site Quality Gate** (depois de mesclado o eiff-site#10). Alterar proteção é administrativo.
4. **Previews do projeto `eiff`**: decidir o isolamento P1 do desenho B + D + C (previews e branch deploys desligados no projeto de produção, homologação em projeto separado). Sem isso, toda mudança do site que gere preview carrega o risco E-2.

## 5. O que não muda

- Nenhuma operação crítica passa a ser automática: migrations, RLS, permissões, credenciais, operações destrutivas e mudanças de alto impacto.
- A Frente A não altera estruturas, migrations ou regras do CRM.
- A trava de publicação dos dois projetos continua ligada. A política publica restaurando deploys já construídos, nunca desligando a trava.

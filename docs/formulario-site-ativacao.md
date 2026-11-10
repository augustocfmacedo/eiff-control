# Formulário do site → EIFF Control: ativação controlada

Runbook de implantação, ensaio, marcos de autorização e reversão. Complementa `docs/formulario-site.md` (o
desenho da integração) e não o substitui.

> Estado em 09/11/2026: **release congelado, nada ativado**. Nenhum push, merge, deploy, credencial, token,
> notificação ou escrita em produção. Os leads antigos guardados no painel do Netlify continuam retidos.
> Cada etapa da §4 depende de autorização expressa da Direção (§11).

## 1. O que é atendimento e o que é promoção

| | onde | quando | quem |
|---|---|---|---|
| **Atendimento imediato** | EIFF Inbox, `#/atendimento` | na hora em que a submissão entra | responsável padrão do COMERCIAL, com prazo de primeira resposta |
| **Evidência** | Lead Engine, aba Candidatos | na mesma hora, PENDING e sem conta | ninguém age automaticamente |
| **Promoção para o Radar** | aba Candidatos → empresa → oportunidade | depois, por decisão humana | comercial |

A ativação cobre a primeira e a segunda linha. A terceira **não é automática e não está ligada a tela**:
`oportunidadeDoFormulario` existe no core e só é usada por um script de demonstração; "Criar empresa" exige
CNPJ e a tela não tem onde informá-lo (só "Associar" a empresa existente funciona). O lead é atendido pelo
Inbox; a oportunidade é trabalho seguinte.

## 2. O responsável: o que foi validado

Simulado com as 8 regras de roteamento lidas da produção (somente leitura) e provado em
`src/core/inbox/formularioRoteamento.test.ts`:

| ponto | resultado |
|---|---|
| setor COMERCIAL ativo | sim, em produção |
| responsável padrão | **nulo em produção** — a conversa cairia no setor, sem dono (`ATRIBUIR_SETOR`) |
| membro ou equipe exigidos? | **não**: o responsável padrão do setor basta para o roteador (`selecionarResponsavel`) e para a RPC `inbox_apply_routing` |
| visibilidade | Administrador é transversal: vê todas as caixas. Único perfil ativo que pode receber: Augusto Macedo |
| prazo | **30 minutos úteis** a partir do instante da submissão (segunda a sexta, 08h–18h, São Paulo; feriados nacionais, o estadual de 26/07 e os de Goiânia, Corpus Christi incluído; ponto facultativo não conta). Regra só do lead do site: os demais canais seguem com as horas corridas da configuração (Normal 24 h). Detalhe em `docs/formulario-site.md` §4.1 |
| encaminhamento para o COMERCIAL | **dependia do texto**: «podem me ligar?» no formulário `iniciar-projeto` ia para a ENGENHARIA com 95% (a palavra «projeto», inclusive a do nome do formulário). Corrigido com a regra `ROT-SITE` (canal PORTAL + contexto EXTERNAL → COMERCIAL, ordem 0) |
| onde aparece | selo do menu Atendimento e caixa «Precisa de mim» (atribuídas a mim); «Não atribuídos»; indicador «SLA vencido», que também ordena a lista |

Limite conhecido: **o EIFF Control não avisa ninguém**. Não há notificação nem agendador de escalação; o lead
aparece para quem abre o sistema. A contingência é o e-mail do Netlify Forms (§10).

## 3. Configuração, variáveis e deploys

### 3.1 A regra que organiza tudo: a variável pertence ao deploy

No Netlify, **cada deploy usa os valores das variáveis existentes no momento em que foi feito**; para um valor
novo chegar a uma função publicada é preciso **um novo deploy** (documentação: «To apply updated environment
variable values, create a new deploy»). Vale para funções comuns, agendadas e de evento. Consequências:

- criar, alterar ou apagar uma variável **não muda nada** no que já está no ar;
- cada grupo de variáveis é criado **antes** do deploy que precisa dele;
- ativar e desativar são, na prática, **publicar um deploy** — é isso que separa «função publicada» de
  «encaminhamento ligado» (§3.3);
- apagar uma variável **não é reversão**: só vale no deploy seguinte. Reversão é publicar um deploy anterior (§7).

Escopo e contexto, a conferir no painel ao criar cada variável:

| ponto | regra | o que fazer |
|---|---|---|
| escopo | a função só lê a variável se o escopo incluir **Functions**. A escolha de escopo existe nos planos Pro e Enterprise; em plano menor a variável vale para todos os escopos | se o seletor aparecer, marcar Functions |
| contexto | Production, Deploy Previews, Branch deploys e outros | criar os valores **só em Production**. O PR do CRM gera deploy de prévia; assim a prévia do endpoint responde 503 e não grava |
| segredo | «Contains secret values» | marcar em `EIFF_FORM_SECRET` e em qualquer token |
| conferência | sem revelar valor | metadados da variável (nome, escopo, contexto, data de alteração: `netlify api getEnvVars`; `env:list` só mostra o contexto dev). **O 401 não prova nada sobre o segredo**: o endpoint responde 401 tanto com o segredo errado quanto sem a variável; 503 `integracao_nao_configurada` é só para organização/fonte. A prova de que os dois lados têm o mesmo valor é a submissão de ensaio virar evidência e conversa. Variável alterada depois do build exige novo deploy do lado alterado |

### 3.2 O que precisa existir

Nenhuma foi feita. Cada linha precisa de autorização.

| # | onde | o quê | antes de qual deploy |
|---|---|---|---|
| C1 | banco (Supabase) | `scripts/formulario-ativacao-producao.sql`: responsável padrão do COMERCIAL = Augusto (provisório) + regra `ROT-SITE`. Idempotente, uma transação, reversão no cabeçalho. Provado em PostgreSQL local; os gatilhos de auditoria de produção não foram exercidos | CRM-1 |
| C2 | Netlify do **eiffcontrol** | `EIFF_FORM_SECRET` (novo, gerado por pessoa, fora de qualquer conversa) · `EIFF_FORM_SOURCE_ID` = `0e238b9c-01f1-4a33-9274-de7f1af8245f` · `EIFF_INBOX_ORGANIZATION_ID` = `e1a7e58f-29d1-4c22-b41e-597ebdeee86e`. `SUPABASE_SERVICE_ROLE_KEY` já existe | CRM-1 |
| C3 | Netlify do **eiff-site** | `EIFF_FORM_SECRET` com o mesmo valor. **Só é criado na ativação** (etapa 9): enquanto não existir, a função do site é inerte. `EIFF_CRM_FORM_ENDPOINT` é opcional e não deve ser criado (o padrão já é o endpoint de produção) | Site-2 |
| C4 | Netlify do **eiffcontrol** (rodada agendada) | credencial de leitura das submissões (§6.1) em `NETLIFY_AUTH_TOKEN` · `EIFF_FORM_NETLIFY_SITE` (site_id do eiff-site) · `EIFF_FORM_MARCO` (o instante da etapa 0) e, por último, `FORMULARIO_RECONCILIACAO=ativa`. `EIFF_FORM_EXCLUIDOS` é opcional | CRM-2 |

### 3.3 Os seis estágios

Cada estágio é um deploy; anotar o id de cada um no momento em que é publicado.

| estágio | o que é | para que serve |
|---|---|---|
| **CRM-0** | a versão anterior (`6ad6568f`, commit `2bc130a`) | volta total do CRM |
| **CRM-1** | integração publicada, com as variáveis C2, **reconciliação desligada** | estado normal depois da implantação; alvo para suspender a reconciliação |
| **CRM-2** | o mesmo código, novo deploy com as variáveis C4 | reconciliação horária ligada. **Só existe depois do GO-2** |
| **Site-0** | a versão anterior do site | volta total do site |
| **Site-1** | encaminhador publicado **sem segredo**: registra `nao_configurado` e não manda nada | função no ar, encaminhamento desligado; **alvo do rollback** |
| **Site-2** | novo deploy, já com o segredo C3 | **encaminhamento ligado — é a ativação de leads reais** |

Duas condições para o Site-1 ser de fato inerte:

1. o nome `EIFF_FORM_SECRET` **não pode existir** no painel do eiff-site antes do merge (conferir pela lista de nomes);
2. o eiff-site publica sozinho a cada merge na `main`. Depois que o segredo existir no painel, **qualquer**
   deploy do site — inclusive o de outra frente — sai com o encaminhador ligado. Por isso o segredo só é criado
   na etapa 9, e a publicação automática do site fica **travada** a partir do Site-1.

## 4. Sequência de implantação

O CRM fica funcional e provado antes de a função do site existir; a função do site é publicada inerte; a
ativação é um ato separado e autorizado. Resultado diferente do esperado em qualquer etapa **interrompe** a sequência.

| # | etapa | operação | evidência a coletar | critério de parada |
|---|---|---|---|---|
| 0 | **Marco** | contar as submissões verificadas no painel do Netlify e anotar o instante (UTC). O marco é ANTERIOR a tudo abaixo (§9) | contagem (11), data da última, marco | mais de 11: são leads reais novos, decisão comercial própria |
| 1 | **Aviso por e-mail** | configurar a notificação do Netlify Forms para `simular-galpao` e `iniciar-projeto` (§10) | notificação salva; destinatário aceito e, se for o caso, confirmado | erro de validação do endereço; confirmação pendente |
| 2 | **C1** | aplicar `scripts/formulario-ativacao-producao.sql` | saída da consulta final | qualquer exceção (o script aborta sozinho) |
| 3 | **Responsável** | leitura independente do setor e da tela `#/atendimento/configuracao` | Augusto como responsável padrão; `ROT-SITE` na ordem 0; as 8 regras anteriores preservadas | responsável nulo ou outro perfil |
| 4 | **C2** | criar as três variáveis do CRM, contexto Production | nomes listados | `SUPABASE_SERVICE_ROLE_KEY` ausente |
| 5 | **Integração do CRM** | push da `feature/radar-formulario-site`, PR, Quality Gate, merge na `main` (frase «MERGE AUTORIZADO»). Sem migration | links do PR e do CI | gate vermelho |
| 6 | **Publicar CRM-1** | destravar, publicar o deploy da `main`, **travar de novo** | id do CRM-1; as duas funções listadas | build falho; função ausente |
| 7 | **Endpoint** | `curl -s -o NUL -w "%{http_code}" -X POST https://eiffcontrol.com.br/api/formulario-site`; abrir o Inbox | `401`; compositor com «Registrar contato já feito» | `404` (não publicado) ou `503` (variável faltando) |
| 8 | **Publicar Site-1** | conferir que `EIFF_FORM_SECRET` não existe no site; push e merge da `release/encaminhador-crm` (pelo nome: a pasta de trabalho do site está em outra branch); **travar a publicação do site** | id do Site-1; `submission-created` listada; página pública idêntica | segredo já presente; página alterada |
| — | **GO-1** | autorização da janela assistida (§11) | registro da autorização | sem GO-1 não se passa daqui |
| 9 | **Ativar: Site-2** | criar C3 (Production), disparar novo deploy do site, publicar e manter travado | id do Site-2 | — |
| 10 | **Ensaio único** | uma submissão pelo formulário público (§5) | verificada no painel; log `entregue`; e-mail de aviso recebido | spam; `recusado`; `nao_entregue`; e-mail não chegou |
| 11 | **Conferência** | `scripts/formulario-ensaio-conferencia.sql` e a tela; rascunho e contato realizado (§8) | itens do GO-2 | conversa sem responsável; prazo diferente |
| 12 | **Idempotência** | reconciliador manual, simulação e depois `--executar --confirmar FORMULARIO_SITE_V1` | a de teste «já dentro»; 11 retidas; contagens iguais às de antes | segunda conversa; histórica elegível |
| — | **GO-2** | homologação provisória (§11) | checklist completo | No-Go: publicar o Site-1 (§7) |
| 13 | **Encerrar o ensaio** | fechar a conversa de teste e rejeitar o candidato, motivo «ensaio» | — | — |
| 14 | **Reconciliação: CRM-2** | definida a credencial (§6.1): criar C4, novo deploy do CRM, publicar, travar | id do CRM-2; na hora cheia, linha `RECONCILIACAO_AGENDADA` com zero a reenviar | 503; qualquer reenvio de histórica |
| — | **GO-3** | operação regular (§11) | resultado da primeira rodada agendada | — |

Notas:

- **Etapa 6.** O CRM-0 corresponde à `main` atual; destravar publica apenas este release.
- **Etapa 8.** A `feature/formulario-para-o-crm` do site carrega também o «resgate do lead», que muda a página
  pública e é decisão separada. O que se publica é a `release/encaminhador-crm` (função, teste e `tsconfig`).
- **Etapas 9 a GO-2 são a janela assistida.** Não há isolamento: a partir do Site-2, toda submissão real
  também é encaminhada ao CRM. Não existe modo «só teste» sem código novo.
- **Etapa 14 só depois do GO-2.** Entre o Site-2 e o CRM-2, um evento perdido fica guardado no Netlify e é
  trazido pela primeira rodada (é posterior ao marco) ou pela reconciliação manual.

## 5. Ensaio fictício único

**O ensaio é UMA submissão REAL e verificada do formulário público**, com dados claramente de teste. O id e o
instante são os que o Netlify atribuiu: nada de data escrita à mão, relógio alterado ou evento montado. É o que
faz o prazo de 30 minutos úteis ser conferido contra o instante verdadeiro (fora do expediente, o vencimento
esperado é 08h30 do próximo dia útil).

| campo | valor |
|---|---|
| nome | `ENSAIO EIFF — TESTE (não é lead)` |
| empresa | `Ensaio de integração EIFF` |
| e-mail | `ensaio-ficticio@exemplo.invalido` (é por ele que a conferência acha o ensaio) |
| telefone | `(62) 90000-0000` |
| observação | `ENSAIO DE CERTIFICAÇÃO site → EIFF Control. Não responder: não existe cliente.` |

Risco conhecido: o filtro de spam do Netlify pode reter um e-mail de domínio inexistente. Se a submissão não
aparecer como **verificada** no painel, repetir com um endereço real da EIFF (e trocar o e-mail na consulta de
conferência). Submissão marcada como spam não dispara o evento, não gera o e-mail de aviso e não entra pela
reconciliação.

O que a submissão única comprova em produção:

| passo | esperado | demonstra |
|---|---|---|
| submissão pelo formulário público (Site-2 no ar) | verificada no painel; log da função com `entregue` | o caminho completo pelo evento |
| e-mail de aviso | chega ao destinatário em poucos minutos | a contingência comercial (§10) |
| `scripts/formulario-ensaio-conferencia.sql` (somente leitura) | 1 evidência PENDING da fonte `WEBSITE`, vinculada à mensagem · COMERCIAL · ATRIBUIDA · responsável · vencimento = 30 min úteis depois de `submetida_em` · contato `lead` · 0 empresas | banco certo, fonte, setor, responsável, prazo |
| no app, como Augusto: `#/atendimento` → «Precisa de mim» → abrir | nome, telefone, empresa, dados do galpão e a linha de origem | o atendente abre |
| registrar um rascunho | a conversa continua «aguardando primeira resposta» | rascunho não cumpre (§8) |
| «Registrar contato já feito» → «Falei com a pessoa» | «respondida dentro do prazo» ou «fora do prazo», conforme o instante real | só contato realizado cumpre |
| reconciliador em simulação, com o marco | a de teste «já dentro»; as 11 históricas em `anterior_ao_marco` | o marco separa o teste das históricas |
| o mesmo, com `--executar --confirmar FORMULARIO_SITE_V1` | nada novo gravado; contagens iguais | reenvio não duplica |

**Limite explícito da homologação de produção.** Como a submissão única é entregue pelo evento, o caminho «o
evento se perdeu e a reconciliação trouxe» **não é exercido em produção**. Ele fica comprovado pelo smoke local
(`npm run smoke:formulario`, 40 provas em PostgreSQL, com os cinco cenários de recuperação) e pelos testes da
rodada agendada. Em produção o ensaio mostra apenas que o reconciliador lê a API real e reconhece a submissão
como já gravada.

Gravam em produção e dependem de autorização: a submissão, o rascunho, o contato realizado, o fechamento da
conversa e a rejeição do candidato.

`scripts/formulario-ensaio-ficticio.json` **não é o ensaio**: é um artefato de simulação local, com data fixa,
usado só para exercitar o reconciliador com `--arquivo` sem rede. Não enviar esse arquivo ao endpoint de produção.

Encerrar: fechar a conversa de teste com motivo «ensaio» e rejeitar o candidato na aba Candidatos com o mesmo
motivo. A evidência é imutável e **fica** (REJECTED); não há como apagá-la, por desenho.

## 6. Reconciliação horária

Executor único: a **Scheduled Function do Netlify** no eiffcontrol (`netlify/functions/formulario-reconciliar.mts`,
`@hourly`), **desligada por padrão** — só roda com `FORMULARIO_RECONCILIACAO = ativa` **e** `EIFF_FORM_MARCO`. O workflow do
GitHub Actions que existia como reserva manual nunca esteve ligado e saiu do release.

- **Ligar é publicar o CRM-2**: criar as variáveis C4 e fazer novo deploy (§3.1). Criar as variáveis sem novo
  deploy não liga nada. **Desligar é publicar o CRM-1** (§7).
- **Alerta**: a rodada que não pôde rodar responde 503 e aparece como falha no painel de Functions; a linha
  `RECONCILIACAO_AGENDADA` traz `falhas` e `recuperadas`. Não há notificação automática.
- **Marco**: `EIFF_FORM_MARCO`. Tudo o que é anterior fica retido; a rodada agendada não tem como incluir anteriores.
- **Mão humana**: `scripts/formulario-reconciliar.mts` (simulação por padrão), validado localmente com a submissão
  fictícia: simulação, retenção pelo marco e os três bloqueios (saída `2`).
- **O que ela não faz**: avisar o comercial e cumprir o prazo de 30 minutos. Um lead recuperado pela rodada chega com o
  prazo contado da submissão original, possivelmente já vencido.
- Não validado: a execução agendada no Netlify (só existe em deploy publicado) e a leitura real da API de submissões.

### 6.1 A credencial de leitura das submissões

A API de submissões do Netlify exige um token. O token pessoal é criado com descrição, data de expiração e a
opção de acesso a equipe com SSO; **a documentação não oferece escopo nem modo somente leitura**. O token age
com as permissões do usuário que o criou, em todos os sites que ele alcança, inclusive escrita (a confirmar na
tela de criação). Revogação em User settings › Applications; trocar a senha da conta invalida todos os tokens.

Ordem de preferência — **nada disto foi criado**:

| | opção | condição |
|---|---|---|
| **B (preferida)** | usuário técnico separado no Netlify, com acesso restrito ao eiff-site; o token é dele, com expiração | depende do plano e dos papéis da equipe; verificar no painel |
| **C (provisória)** | sem token guardado: reconciliação **manual**, por uma pessoa logada, com o script; a rodada horária fica desligada (não há CRM-2) | a operação fica classificada como **provisória** (GO-3) |
| **A (só com aceitação)** | token pessoal amplo, com expiração curta, marcado como segredo, só em Production | **não é criado automaticamente**: exige aceitação expressa do risco pela Direção |

Se B não estiver disponível, avaliar C antes de A.

## 7. Reversão

Reverter é **publicar um deploy anterior** («Publish deploy»): é instantâneo e não gera build. Prioridade:

| # | situação | operação | efeito |
|---|---|---|---|
| 1 | suspender o encaminhamento | publicar o **Site-1** e manter a publicação do site travada | imediato; a página pública não muda; as submissões ficam guardadas no Netlify |
| 2 | suspender a reconciliação, se estiver ativa | publicar o **CRM-1** e manter travado | imediato; endpoint e Inbox seguem funcionando |
| 3 | o CRM está funcionando | **não mexer** | a correção do cumprimento do SLA permanece |
| 4 | falha atribuível ao release do CRM | publicar o **CRM-0**; depois reverter o merge | endpoint `404`; sem migration, nada a desfazer no schema. Efeito colateral: com o CRM antigo o rascunho volta a parar o relógio do SLA |
| 5 | o que já entrou | nada é apagado | conversa fechada com motivo; candidato REJECTED; a evidência fica |

Cuidados:

- **Publicação automática.** Com ela ligada, o próximo deploy vindo do git **sobrescreve** o rollback. Travar
  («Lock to stop auto publishing») logo depois de qualquer rollback, nos dois sites.
- **Variáveis no rollback.** O deploy republicado deve rodar com as variáveis da época dele (Site-1 sem
  segredo; CRM-1 sem as da reconciliação). É o que a regra da §3.1 sustenta, mas a documentação **não descreve
  expressamente** o caso do rollback: **conferir durante a implantação**. No site, o sinal é o log da função
  com `nao_configurado` na submissão seguinte; no CRM, a ausência de novas linhas `RECONCILIACAO_AGENDADA`
  com rodada executada.
- **Apagar variável não reverte.** Só vale no deploy seguinte. Depois de um rollback, apagar o segredo do site
  serve para impedir que um deploy futuro reative o encaminhamento.
- **Configuração do banco.** Os dois `update` do cabeçalho de `scripts/formulario-ativacao-producao.sql`
  devolvem o COMERCIAL ao estado sem responsável e sem a regra. Só se o CRM for revertido.
- **Voltar ao Site-0** (tirar a função) só é necessário se a própria função publicada causar problema;
  para parar o encaminhamento, o Site-1 basta.

## 8. Cumprimento do SLA: só contato realizado

**O defeito (corrigido em 09/11/2026).** «Registrar rascunho de resposta» marcava a conversa como respondida:
o provider do canal é MANUAL, a mensagem fica com entrega `registrada`, nada é enviado — e mesmo assim o
relógio parava. Resolver ou fechar sem resposta também saía como «cumprido».

**A regra agora.** Só cumpre o SLA de primeira resposta o contato efetivamente realizado: declarado por uma
pessoa («Registrar contato já feito» → «Falei com a pessoa») ou enviado de fato por um canal, quando houver
um ligado. Rascunho, nota interna, assumir, reatribuir, tentativa sem sucesso e encerramento não cumprem.

| situação na tela | quando |
|---|---|
| aguardando primeira resposta | sem contato realizado e conversa aberta (no prazo, vencendo ou vencida) |
| respondida dentro do prazo | o primeiro contato realizado é anterior ou igual ao vencimento |
| respondida fora do prazo | o primeiro contato realizado é posterior ao vencimento |
| encerrada sem resposta | resolvida ou fechada sem nenhum contato realizado |

No ensaio (§4, etapa 11): registrar um rascunho e conferir que a conversa continua «aguardando»; depois
registrar o contato realizado e conferir «respondida dentro do prazo» ou «fora do prazo», conforme o instante.

Sem migration. Detalhe do modelo e dos limites em `docs/eiff-inbox.md` §17.

## 9. O marco da reconciliação

O marco é o instante a partir do qual uma submissão do painel do Netlify pode entrar no CRM pela reconciliação.

| requisito | como o marco atende |
|---|---|
| as 11 históricas ficam fora | o marco é **posterior** à mais recente delas (03/11/2026). Antes do marco, a rodada agendada retém sempre, sem opção de liberar |
| submissão nova entre o deploy do CRM e o do site não é esquecida | o marco é **anterior** ao deploy do CRM. Nesse intervalo a função do site ainda não existe; a submissão fica no Netlify e é elegível |
| submissão anterior à ativação da reconciliação, mas posterior ao marco | elegível: a rodada compara o instante da submissão com o marco, não com a hora em que foi ligada |
| idempotência e rastreabilidade | a identidade é o id do Netlify nas duas gravações; o que o evento já entregou é reconhecido como «já dentro» e não é regravado |

**Marco seguro = o instante registrado imediatamente ANTES de começar a implantação**, depois de conferir que o
painel continua com as mesmas 11 submissões. Não usar o instante da ativação da reconciliação (deixaria de fora
tudo o que chegou entre o deploy do CRM e o momento de ligar).

Se, ao registrar o marco, o painel tiver **mais** que 11 submissões, as novas são leads reais chegados depois de
03/11 e ficarão retidas como as demais: não são esquecidas, mas precisam de decisão comercial própria antes de
seguir — não é caso para mover o marco para trás.

Provado em `formularioAgendado.test.ts` («o marco na sequência CRM → site → reconciliação»): desligada não lê
nada; ao ligar, a histórica fica retida e as três posteriores ao marco entram; a rodada seguinte não regrava.

Consequência conhecida: a submissão recuperada chega com o prazo contado do instante original, em geral já vencido.

## 10. Aviso de lead novo e acompanhamento

O EIFF Control **não avisa** ninguém: o lead aparece no selo do menu e em «Precisa de mim» para quem está com o
sistema aberto. Não há e-mail, push nem agendador de escalação, e nenhum canal de saída está autorizado.

**Contingência: a notificação nativa por e-mail do Netlify Forms**, configurada **antes da ativação** (§4,
etapa 1). O Netlify envia notificação por e-mail para submissões **verificadas**, de um formulário específico
ou de todos do site (painel do eiff-site › Forms › notificações). Não é o webhook descartado no desenho —
aquele não aceitava cabeçalho; este é só e-mail e não depende de nada do CRM nem da função do site.

| | |
|---|---|
| configurar | uma notificação para `simular-galpao` e outra para `iniciar-projeto`. **Não configurado** |
| destinatário | **ainda a confirmar pela Direção.** Não presumir endereço. Tem de ser lido no celular por quem atende |
| requisito do endereço | o destinatário precisa ser **membro ativo da equipe do Netlify** ou um endereço externo que **confirme** pelo e-mail de confirmação. A confirmação de endereço externo está sendo liberada aos poucos; onde ainda não existe, só endereço de membro é aceito (o painel recusa com erro de validação). Enquanto o endereço não confirmar, **nada é enviado** — verificar a confirmação antes da etapa 9 |
| prova | o ensaio (§5) tem de gerar o e-mail. Sem e-mail recebido não há GO-2 |
| o que entrega | o conteúdo da submissão. O lead continua entrando no CRM pelo caminho normal: o e-mail é só o aviso |
| limites | remetente `formresponses@netlify.com` (responder ao aviso **não** responde ao lead); há relatos de e-mails que não chegam (lista de supressão, filtros) — não é garantia; o conteúdo do lead passa a existir também numa caixa de e-mail |
| o que não substitui | o registro do contato no Inbox e a reconciliação |

**Acompanhamento.**

- **Durante a janela assistida** (etapa 9 até o GO-2): monitoramento manual e contínuo, com o Inbox e o painel
  do Netlify Forms abertos por quem conduz a implantação.
- **Depois do GO-2**: o e-mail é o gatilho; ao receber, abrir «Precisa de mim» e registrar o contato realizado.
- **Contingência**: consultar o painel do Netlify Forms e comparar com as conversas do canal Portal — é a
  fonte que mostra o que chegou mesmo se o e-mail e o evento falharem. Com a reconciliação ligada, olhar também
  o log da função agendada (`falhas`, `recuperadas`).
- **Consultas periódicas ao sistema não garantem o prazo.** Com 30 minutos úteis, olhar o Inbox algumas vezes
  por dia não basta: sem o e-mail funcionando, o prazo só é cumprido por quem está com o sistema aberto. A
  frequência de acompanhamento é decisão comercial e deve ser assumida como limite da operação, não como garantia.

Pendente para o futuro (fora desta etapa): aviso interno do próprio EIFF Control — novo lead, prazo vencendo e
vencido —, que depende de um canal de saída autorizado e de um agendador de escalação (hoje só o contrato existe).

## 11. Marcos de autorização

Três decisões da Direção, separadas. Nenhuma é implícita na anterior.

### GO-1 — Autorização da janela assistida

Exigido **antes da publicação do Site-2** (etapa 9). A Direção autoriza expressamente que, durante o ensaio,
**submissões reais também sejam encaminhadas ao CRM** — não há como isolar o teste. Pré-condições:

- [ ] marco anotado e 11 submissões conferidas (etapa 0)
- [ ] notificação por e-mail configurada e destinatário confirmado (etapa 1)
- [ ] COMERCIAL com Augusto como responsável e `ROT-SITE` instalada (etapas 2 e 3)
- [ ] CRM-1 publicado e travado; endpoint respondendo `401` (etapas 6 e 7)
- [ ] Site-1 publicado, inerte, com a publicação travada; página pública idêntica (etapa 8)
- [ ] ids de CRM-0, CRM-1, Site-0 e Site-1 anotados
- [ ] alguém disponível para acompanhar a janela e atender um lead real, se chegar

### GO-2 — Homologação provisória

Depois do ensaio único (etapas 10 a 12). Evidências exigidas:

- [ ] submissão verificada no painel do Netlify
- [ ] evidência `WEBSITE` na fonte correta
- [ ] uma conversa, sem duplicação
- [ ] Augusto como responsável
- [ ] prazo de 30 minutos úteis contado do instante real da submissão
- [ ] rascunho sem cumprimento do SLA
- [ ] contato realizado com o cumprimento correto (dentro ou fora do prazo, conforme o instante)
- [ ] e-mail de aviso recebido
- [ ] idempotência: reenvio sem nada novo gravado
- [ ] nenhuma empresa ou oportunidade criada automaticamente
- [ ] 11 submissões históricas retidas
- [ ] id do Site-2 anotado e publicações travadas nos dois sites

Não se exige o CRM-2 aqui: ele só passa a existir com a ativação da reconciliação. **No-Go** = publicar o
Site-1 (§7); o que já entrou é preservado e atendido.

### GO-3 — Operação regular

Depois da **primeira execução agendada** da reconciliação e da conferência do resultado:

- [ ] credencial definida conforme a §6.1 (B; ou A com aceitação expressa)
- [ ] CRM-2 publicado e travado; id anotado
- [ ] linha `RECONCILIACAO_AGENDADA` da primeira rodada sem falha
- [ ] nenhuma histórica reenviada; a submissão de teste reconhecida como já dentro

Enquanto a reconciliação automática não estiver ativa (opção C ou decisão pendente), a operação é
**PROVISÓRIA**, condicionada à rotina manual: reconciliação manual por pessoa logada e conferência do painel do
Netlify Forms contra o Inbox.

## 12. Riscos residuais

- Lead real pode entrar durante a janela assistida; não há isolamento.
- A recuperação de evento perdido não é exercida em produção (§5).
- O e-mail do Netlify é o único aviso e não é garantia de entrega; sem ele o prazo de 30 minutos depende de quem está com o sistema aberto.
- A credencial da reconciliação não tem escopo restrito, se a opção A for a escolhida.
- O comportamento das variáveis no rollback apoia-se na regra do deploy, não em texto expresso da documentação.
- Os gatilhos de auditoria de produção nunca foram exercidos com o SQL de configuração.
- A função agendada nunca foi executada no Netlify.
- O instante do contato realizado é declarado e pode ser antedatado; fica o rastro (autor e hora do registro).
- Ninguém além do Augusto está apto a receber o lead; ausência dele é ausência de atendimento.

## 13. Registro da primeira janela (10/11/2026) — GO-1 interrompido

- CRM-1c `6af375b6` (commit `8a43719`) publicado e travado depois da rotação do segredo. O CRM-1b `6af31456` carrega o
  segredo anterior e **não serve de rollback de integração**.
- A `main` do site mudou duas vezes por outra frente durante a janela (`faeb898`, `dc1ff72`). O deploy inerte de
  referência passou a ser o `6af32e64` (`dc1ff72`, com a foto da solda).
- Site-2 `6af37886` ficou no ar das 17:04 às 17:29. A submissão de ensaio `6af379040c7080bc34020601` (17:05:24) provou
  autenticação, evidência WEBSITE PENDING sem entidade, conversa no COMERCIAL com responsável, regra ROT-SITE e prazo de
  30 minutos úteis (17:35:24). Zero empresas e oportunidades criadas. Nenhum lead real na janela.
- **Falhou a etapa do Inbox**: nenhuma alteração de conversa era gravada (`permission denied for table inbox_thread`).
  Causa, correção e provas em `docs/eiff-inbox.md` §18. O rascunho não chegou ao banco e o contato não foi registrado.
- Rollback do site para o `6af32e64` às 17:29. O contato real do ensaio foi um e-mail de contato@ para augusto@ às 17:20
  (entre aliases da mesma caixa), ainda **não registrado** no sistema.
- **Retomada**: depois do deploy do CRM com a correção, o GO-1 continua na MESMA conversa de ensaio, sem nova submissão:
  rascunho → contato realizado declarado para 17:20 de 10/11 (o registro terá o horário real da gravação) →
  idempotência → evidências para o GO-2. Lição para o checklist: conferir «gravado» no banco, nunca só na tela.

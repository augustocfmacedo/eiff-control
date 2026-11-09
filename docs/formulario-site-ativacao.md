# Formulário do site → EIFF Control: ativação controlada

Roteiro de publicação, ensaio fictício e reversão. Complementa `docs/formulario-site.md` (o desenho da
integração) e não o substitui.

> Estado em 09/11/2026: **tudo preparado localmente, nada ativado**. Nenhum push, merge, deploy, credencial
> ou escrita em produção. Os leads antigos guardados no painel do Netlify continuam retidos.

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

Limite conhecido: **ninguém é avisado**. Não há notificação nem agendador de escalação; o lead aparece para
quem abre o sistema.

## 3. Configuração de produção ainda necessária

Nenhuma foi feita. Cada linha precisa de autorização.

| # | onde | o quê |
|---|---|---|
| C1 | banco (Supabase) | `scripts/formulario-ativacao-producao.sql`: responsável padrão do COMERCIAL = Augusto (provisório) + regra `ROT-SITE`. Idempotente, uma transação, reversão no cabeçalho. Provado em PostgreSQL local; os gatilhos de auditoria de produção não foram exercidos |
| C2 | Netlify do **eiffcontrol** | `EIFF_FORM_SECRET` (novo, gerado por pessoa) · `EIFF_FORM_SOURCE_ID` = `0e238b9c-01f1-4a33-9274-de7f1af8245f` · `EIFF_INBOX_ORGANIZATION_ID` = `e1a7e58f-29d1-4c22-b41e-597ebdeee86e`. `SUPABASE_SERVICE_ROLE_KEY` já existe |
| C3 | Netlify do **eiff-site** | `EIFF_FORM_SECRET` com o mesmo valor (e a URL do CRM, se a função a ler de variável) |
| C4 | Netlify do **eiffcontrol** (rodada agendada) | `NETLIFY_AUTH_TOKEN` (só leitura de submissões) · `EIFF_FORM_NETLIFY_SITE` (site_id do eiff-site) · `EIFF_FORM_MARCO` (instante da ativação) e, por último, `FORMULARIO_RECONCILIACAO=ativa` |

## 4. Ordem de publicação

O CRM fica funcional e provado **antes** de a função do site existir.

0. **Marco**: anotar o instante (UTC) e conferir no painel do Netlify que as submissões guardadas são as mesmas 11
   (§9). O marco é ANTERIOR a tudo o que vem abaixo.
1. **C1** (banco) e **C2** (variáveis do CRM).
2. **Publicar o eiff-control** (merge da `feature/radar-formulario-site` + deploy). Sem migration.
3. **Provar o endpoint** (§5, passos 1 a 6). O site ainda não manda nada.
4. **C3** e **publicar o eiff-site** pela branch limpa `release/encaminhador-crm` (só a função, o teste e o
   `tsconfig`; a `feature/formulario-para-o-crm` carrega também o «resgate do lead», que muda a página
   pública e é decisão separada). O merge na `main` do site publica sozinho.
5. **Ensaio pelo site** (§5, passo 7).
6. **C4**: anotar o instante como marco e ligar a reconciliação horária (o interruptor por último).

## 5. Ensaio fictício

**O ensaio definitivo é uma submissão REAL e verificada do formulário público**, com dados claramente de teste.
O id e o instante são os que o Netlify atribuiu: nada de data escrita à mão, relógio alterado ou evento
montado. É o que faz o prazo de 30 minutos úteis ser conferido contra o instante verdadeiro.

A primeira submissão é única e identificada como teste:

| campo | valor |
|---|---|
| nome | `ENSAIO EIFF — TESTE (não é lead)` |
| empresa | `Ensaio de integração EIFF` |
| e-mail | `ensaio-ficticio@exemplo.invalido` (é por ele que a conferência acha o ensaio) |
| telefone | `(62) 90000-0000` |
| observação | `ENSAIO DE CERTIFICAÇÃO site → EIFF Control. Não responder: não existe cliente.` |

Risco conhecido: o filtro de spam do Netlify pode reter um e-mail de domínio inexistente. Se a submissão não
aparecer como **verificada** no painel, repetir com um endereço real da EIFF (e trocar o e-mail na consulta de
conferência). Submissão marcada como spam não dispara o evento nem entra pela reconciliação.

O ensaio tem duas submissões, porque há dois caminhos de entrada a provar, e a ordem delas segue a da publicação:

| # | quando | passo | esperado | demonstra |
|---|---|---|---|---|
| 1 | CRM publicado, site ainda sem a função | `curl -s -o NUL -w "%{http_code}" -X POST https://eiffcontrol.com.br/api/formulario-site` | `401` (não `404`, não `503`) | endpoint publicado e autenticado |
| 2 | idem | **submissão de teste nº 1** pelo formulário público | aparece como verificada no painel do Netlify; **nada** chega ao CRM (a função do site ainda não existe) | o estado «submissão nova entre o deploy do CRM e o do site» |
| 3 | idem | `npx vite-node scripts/formulario-reconciliar.mts -- --site <site_id> --marco <marco>` | simulação: `aReenviar: 1`, as históricas em `anterior_ao_marco` | o marco separa o teste das históricas |
| 4 | idem | o mesmo, com `--executar --confirmar FORMULARIO_SITE_V1` | `200 REGISTRADO` | recebida e gravada **pelo caminho de recuperação** |
| 5 | idem | repetir o passo 4 | `200 IDEMPOTENTE` | reenvio não duplica |
| 6 | idem | `scripts/formulario-ensaio-conferencia.sql` (somente leitura) | 1 evidência PENDING da fonte `WEBSITE`, vinculada à mensagem · COMERCIAL · ATRIBUIDA · responsável · vencimento = 30 min úteis depois de `submetida_em` · contato `lead` · 0 empresas | banco certo, fonte, setor, responsável, prazo |
| 7 | idem | no app, como Augusto: `#/atendimento` → «Precisa de mim» → abrir; conferir nome, telefone, empresa, dados do galpão e a linha de origem; mudar para Em atendimento; registrar nota interna | permitido | o atendente abre e atualiza |
| 8 | **site publicado** | **submissão de teste nº 2** (outro e-mail de teste, ex.: `ensaio-ficticio-2@exemplo.invalido`) | conversa nova em segundos, com o prazo correndo | o evento do site entrega sem a reconciliação |
| 9 | idem | reconciliador em simulação | as duas de teste já dentro; históricas retidas | nada ficou para trás |

Se o passo 6 mostrar a conversa **sem responsável** ou com outro prazo, parar antes do passo 8.

`scripts/formulario-ensaio-ficticio.json` **não é o ensaio definitivo**: é um artefato de simulação local, com
data fixa, usado só para exercitar o reconciliador com `--arquivo` sem rede. Não enviar esse arquivo ao
endpoint de produção.

Encerrar: fechar as conversas de teste com motivo «ensaio» e rejeitar os candidatos na aba Candidatos com o
mesmo motivo. A evidência é imutável e **fica** (REJECTED); não há como apagá-la, por desenho.

## 6. Reconciliação horária

Executor único: a **Scheduled Function do Netlify** no eiffcontrol (`netlify/functions/formulario-reconciliar.mts`,
`@hourly`), **desligada por padrão** — só roda com `FORMULARIO_RECONCILIACAO = ativa` **e** `EIFF_FORM_MARCO`. O workflow do
GitHub Actions que existia como reserva manual nunca esteve ligado e saiu do release.

- **Alerta**: a rodada que não pôde rodar responde 503 e aparece como falha no painel de Functions; a linha
  `RECONCILIACAO_AGENDADA` traz `falhas` e `recuperadas`. Não há notificação automática.
- **Marco**: `EIFF_FORM_MARCO`. Tudo o que é anterior fica retido; a rodada agendada não tem como incluir anteriores.
- **Mão humana**: `scripts/formulario-reconciliar.mts` (simulação por padrão), validado localmente com a submissão
  fictícia: simulação, retenção pelo marco e os três bloqueios (saída `2`).
- **O que ela não faz**: avisar o comercial e cumprir o prazo de 30 minutos. Um lead recuperado pela rodada chega com o
  prazo contado da submissão original, possivelmente já vencido.
- Não validado: a execução agendada no Netlify (só existe em deploy publicado) e a leitura real da API de submissões.

## 7. Reversão

| situação | ação | efeito |
|---|---|---|
| parar a entrada já | apagar `EIFF_FORM_SECRET` em um dos dois sites | 401 na borda; as submissões ficam no painel do Netlify |
| parar a reconciliação | `FORMULARIO_RECONCILIACAO` ≠ `ativa` | o job deixa de rodar |
| tirar a função do site | reverter o merge da `release/encaminhador-crm` | a página pública não muda |
| tirar o endpoint | reverter o merge no eiff-control e publicar | `404`; nada a desfazer no banco (sem migration) |
| desfazer a configuração | os dois `update` do cabeçalho de `scripts/formulario-ativacao-producao.sql` | COMERCIAL volta a ficar sem responsável e sem a regra |
| o que já entrou | nada é apagado | conversa fechada com motivo; candidato REJECTED |

## 8. Cumprimento do SLA: falso cumprimento e a correção mínima proposta

**Achado (09/11/2026).** O único gesto que registra a primeira resposta é «Registrar rascunho de resposta»
(`actions.inboxResponder`). O provider do canal é MANUAL: a mensagem fica com entrega `registrada`, **nada é
enviado**, e mesmo assim `aoResponder` grava `primeiraRespostaEm` — o SLA vira «respondida». Um rascunho
encerra o prazo. Resolver ou fechar a conversa também tira o selo de atraso, sem registrar resposta.

**Requisito.** Só uma resposta efetivamente realizada, ou registrada como realizada por uma pessoa, cumpre o prazo.

**Correção mínima proposta — NÃO implementada, espera decisão** (muda a regra de SLA de todos os canais do Inbox):

1. `inboxResponder` deixa de marcar a primeira resposta quando a entrega é só `registrada` (rascunho). O rascunho
   continua existindo e continua levando a conversa a Em atendimento.
2. O compositor ganha um terceiro modo, ao lado de «nota interna» e «rascunho»: **«Contato realizado»** — meio
   (telefone, e-mail, WhatsApp pessoal, presencial), instante (padrão agora, nunca no futuro) e resumo. Vira uma
   mensagem de saída com entrega `enviada` e o meio em `meta`, e é ela que chama `aoResponder`.
3. O painel de SLA passa a distinguir «respondida» de «encerrada sem resposta».

Sem migration (`delivery_state` já aceita `enviada`; `meta` já existe). Arquivos: `src/data/store.ts`,
`src/core/inbox/estados.ts`, `src/screens/Inbox.tsx` e os testes do Inbox. Estimativa: meio dia.
Enquanto não for feita, o número «respondidas no prazo» não é confiável.

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

## 10. Aviso de lead novo: contingência inicial

O EIFF Control **não avisa** ninguém: o lead aparece no selo do menu e em «Precisa de mim» para quem está com o
sistema aberto. Não há e-mail, push nem agendador de escalação, e nenhum canal de saída está autorizado.

**Contingência: a notificação nativa por e-mail do Netlify Forms.** O Netlify permite notificação por e-mail para
submissões **verificadas**, de um formulário específico ou de todos do site (painel do eiff-site › Forms ›
notificações de submissão). Não é o webhook descartado no desenho — aquele não aceitava cabeçalho; este é só
e-mail e não depende de nada do CRM.

| | |
|---|---|
| configurar | uma notificação por e-mail para `simular-galpao` e outra para `iniciar-projeto`, para o endereço de quem atende. **Não configurado nesta etapa** |
| o que entrega | o conteúdo da submissão, na hora. O lead continua entrando no CRM pelo caminho normal: o e-mail é só o aviso |
| limites | o remetente é um endereço do Netlify (responder ao e-mail não responde ao lead); há relatos de e-mails que não chegam (lista de supressão, filtros) — testar com a submissão de teste e não tratar como garantia; o conteúdo do lead passa a existir também numa caixa de e-mail |
| o que não substitui | o registro da resposta no Inbox e a reconciliação |

Pendente para o futuro (fora desta etapa): aviso interno do próprio EIFF Control — novo lead, prazo vencendo e
vencido —, que depende de um canal de saída autorizado e de um agendador de escalação (hoje só o contrato existe).


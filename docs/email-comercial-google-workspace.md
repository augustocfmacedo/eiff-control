# E-mail comercial — procedimento assistido do Google Workspace

**Situação: PREPARADO, NÃO EXECUTADO.** Nenhum projeto, cliente OAuth, credencial ou variável foi criado.
Data: 13/11/2026. Substitui, para a execução, o §2 de `docs/email-comercial-e0.md` (que fica como registro do desenho).

**Quem executa: o Augusto, pessoalmente, no próprio navegador e no próprio terminal.** O agente não abre o console do
Google, não cria nada, não roda o script de consentimento e não vê nem recebe nenhum segredo. **Nunca envie senha, ID
de cliente com segredo, segredo do cliente ou token pelo chat.**

---

## 0. O que mudou no Google desde o roteiro da E0 (conferido em 13/11/2026)

| # | Mudança | Efeito no procedimento |
|---|---|---|
| 1 | A tela de consentimento virou o **Google Auth Platform** (menu ☰ › Google Auth Platform), com as páginas **Branding**, **Audience**, **Data Access** e **Clients** | Os menus abaixo já usam os nomes novos. «Interno» é escolhido em **Audience**; o escopo entra em **Data Access** |
| 2 | Desde junho de 2025, o **segredo do cliente só aparece uma vez**, na tela de criação. Depois fica mascarado | **Não feche a tela de criação** até o segredo estar no script e no painel do Netlify (passos 9 a 13). Perdeu? Não há como ver de novo: gera-se um segredo novo pela rotação de segredo do cliente |
| 3 | No Admin Console, o acesso de cada app fica em **Segurança › Acesso e controle de dados › Controles de API › Gerenciar acesso a apps**, com quatro níveis: Confiável, **Dados específicos do Google** (*Specific Google data*), Limitado e Bloqueado. Apps internos **não** recebem nível nenhum automaticamente. O app pode ser configurado **pelo ID do cliente** («Configurar novo app»), sem esperar que apareça na lista | O passo 15 configura o app pelo ID do cliente com **Dados específicos do Google**, só com `gmail.send`. **Não** se usa Confiável (dá acesso a todos os serviços) e **não** se restringe o Gmail da organização (§6) |
| 4 | A revogação pelo usuário fica em **myaccount.google.com/linkedapps** (Acesso à sua Conta do Google) | Atualizado em §5 (como desfazer) |

Confirmado sem mudança: Gmail API ativada em **APIs e serviços › Biblioteca**; cliente do tipo **App para computador**
(*Desktop app*) com retorno em loopback `127.0.0.1` (o Google mantém esse retorno para esse tipo e recomenda PKCE,
que o script já usa); o token de atualização deixa de valer quando a **senha da conta muda** (tokens com escopo do
Gmail), quando fica **seis meses sem uso** ou quando o acesso é revogado. A expiração de 7 dias vale só para app
**Externo** em modo «Teste»: com **Interno** ela não se aplica.

Os menus podem aparecer em português ou inglês, conforme o idioma da conta. Os nomes em inglês estão entre parênteses
quando ajudam a achar o item.

---

## 1. Antes de começar (uns 5 minutos)

- [ ] Ter à mão: acesso de **superadministrador** do Workspace `eiff.com.br`; a **senha da conta `contato@eiff.com.br`**
      (você digita só no Google); acesso ao painel do Netlify do site `eiff-control`; o repositório atualizado
      (`git pull`) no seu computador, com `npm ci` feito.
- [ ] Reservar **uma sessão contínua** para os passos 9 a 13: o segredo do cliente só aparece uma vez.
- [ ] Ter um **gerenciador de senhas da empresa** aberto, caso precise guardar o segredo por alguns minutos. Não use
      bloco de notas, e-mail, chat ou documento.

## 2. Verificação da conta remetente (Admin Console, só leitura)

`admin.google.com`, logado como superadministrador.

- [ ] **Diretório › Usuários**, buscar `contato`: deve existir um **usuário** com e-mail principal
      `contato@eiff.com.br` (já confirmado em 11/11: usuário com caixa própria). Anote se continua assim.
- [ ] No mesmo usuário, **Segurança**: a **verificação em duas etapas** deve estar **ativada**. Se não estiver, ative
      antes de seguir.
- [ ] **Apps › Google Workspace › Gmail › Roteamento**: não deve haver regra que desvie `contato@` para outro lugar.

Resultado esperado, numa linha (para me dizer no chat): «contato@ é usuário, 2FA ligada, sem roteamento».

## 3. Projeto e Gmail API (`console.cloud.google.com`)

Logado como **administrador do domínio** (não como `contato@`).

- [ ] **Seletor de projeto › Novo projeto**. Nome: `eiff-control-email`. **Organização: `eiff.com.br`** (sem a
      organização, a opção «Interno» do passo 6 não aparece). Criar.
- [ ] Com o projeto novo selecionado: **APIs e serviços › Biblioteca** (*APIs & Services › Library*), buscar
      **Gmail API**, **Ativar**. Nenhuma outra API.
- [ ] Faturamento: não é necessário.

## 4. Google Auth Platform (antiga tela de consentimento)

Ainda no projeto `eiff-control-email`: **☰ › Google Auth Platform › Branding** (*Visão geral da marca*). Se aparecer
«Google Auth Platform ainda não configurado», clicar em **Primeiros passos** (*Get started*).

- [ ] **Informações do app**: nome do app `EIFF Control — e-mail comercial`; e-mail de suporte: o do administrador.
      **Próxima**.
- [ ] **Público-alvo** (*Audience*): **Interno** (*Internal*). **Próxima**. Se só aparecer «Externo», pare: o projeto
      não está na organização (volte ao passo 3).
- [ ] **Dados de contato**: e-mail do administrador. **Próxima**.
- [ ] **Concluir**: aceitar a política de dados do usuário das APIs do Google, **Continuar**, **Criar**.
- [ ] **Data Access › Adicionar ou remover escopos** (*Add or remove scopes*): marcar **somente**
      `https://www.googleapis.com/auth/gmail.send` («Enviar e-mails em seu nome»). **Atualizar**, **Salvar**.
      Não marque leitura, composição, `mail.google.com` nem configurações. (Para app interno o Google não exige essa
      lista, mas ela documenta o que o app pede; o script confere de novo e recusa qualquer escopo a mais.)

## 5. Cliente OAuth e token de atualização — **numa sessão só**

> A partir daqui o segredo do cliente aparece **uma única vez**. Faça 9 a 13 sem fechar a tela de criação.

- [ ] **9. Criar o cliente.** **Google Auth Platform › Clients › Criar cliente** (*Create client*). Tipo de aplicativo:
      **App para computador** (*Desktop app*). Nome: `eiff-control-email-script`. **Criar**.
      A tela mostra o **ID do cliente** e o **segredo do cliente**. **Não feche.** Não baixe o JSON (ele grava o
      segredo em disco).
- [ ] **10. Navegador.** Abra uma **janela anônima** e entre nela como `contato@eiff.com.br`.
- [ ] **11. Terminal (o seu, não o do agente).** Na pasta do repositório:
      ```bash
      node scripts/email-oauth-consentimento.mjs
      ```
      O script pede o **ID do cliente** (aparece na tela) e o **segredo do cliente** (digitação **oculta**: cole e tecle
      Enter; nada aparece). Em seguida mostra um endereço `https://accounts.google.com/…`.
- [ ] **12. Consentimento.** Cole esse endereço **na janela anônima logada como `contato@`**. A tela do Google deve
      mostrar **uma** permissão: «Enviar e-mails em seu nome». Se mostrar qualquer outra, **Cancelar** e me avisar.
      Aceite. O navegador volta para `127.0.0.1` e mostra «Consentimento concluído».
      O terminal mostra o tamanho e os 4 últimos caracteres do token, e o **token de atualização fica na área de
      transferência** (não é impresso).
- [ ] **13. Netlify, na mesma sessão.** `app.netlify.com` › site `eiff-control` › **Configuração do site › Variáveis de
      ambiente** (*Site configuration › Environment variables*) › **Adicionar variável**. Para cada uma, escopo
      **Functions**, marcar **Contém valores secretos** quando houver a opção, **sem** prefixo `VITE_`:

      | Variável | Valor |
      |---|---|
      | `GOOGLE_OAUTH_REFRESH_TOKEN` | colar da área de transferência (é o que está lá agora) |
      | `GOOGLE_OAUTH_CLIENT_ID` | o ID da tela do Google |
      | `GOOGLE_OAUTH_CLIENT_SECRET` | o segredo da tela do Google |
      | `EIFF_EMAIL_SENDER` | `contato@eiff.com.br` |
      | `EIFF_EMAIL_SEND_MODE` | `disabled` |

      Volte ao terminal e tecle **Enter**: o script limpa a área de transferência.
      **Só então** feche a tela de criação do cliente no Google.
- [ ] **14.** Feche o terminal e a janela anônima.

Não criar agora: `EIFF_INBOX_OUTBOUND_ENABLED` (fica ausente), `EIFF_EMAIL_CANARY_RECIPIENTS` (só no canário).
Opcionais, com os valores padrão já decididos: `EIFF_EMAIL_SENDER_NAME` = `EIFF`, limites diários 30 e 100.

Criar as variáveis **não muda nada no ar**: o código de envio não está publicado e o modo é `disabled`. Elas só são
lidas depois de uma publicação, que é autorização separada.

## 6. Política de acesso do app (Admin Console)

**Escolha:** nível **Dados específicos do Google** (*Specific Google data*) com **um** escopo,
`https://www.googleapis.com/auth/gmail.send`. Segundo a central de ajuda do Google, nesse nível o app «só pode pedir
acesso aos escopos que você especificar ao configurá-lo», e isso vale também quando o Gmail da organização **não** está
restrito. É compatível com o fluxo escolhido (cliente «App para computador», consentimento pela própria conta
`contato@`, um único escopo): o app nunca pede nada além de `gmail.send`, e o script recusa qualquer escopo a mais.

**Descartado:** **Confiável** (*Trusted*). Daria ao app acesso a todos os serviços e escopos do Workspace, inclusive os
restritos. É mais do que o envio precisa.

O ID do cliente fica visível a qualquer momento em **Google Auth Platform › Clients** (só o segredo é que some); não
é segredo e pode ser copiado para este passo.

- [ ] **15. Configurar o app pelo ID do cliente.** `admin.google.com` › **Segurança › Acesso e controle de dados ›
      Controles de API › Gerenciar acesso a apps** (*Manage App Access*) › em **Apps configurados**, **Configurar novo
      app** (*Configure new app*) › colar o **ID do cliente** › **Pesquisar** › clicar no app encontrado.
      - **Escopo** (unidade organizacional): a de nível superior, ou só a unidade onde está `contato@`.
      - **Acesso aos dados do Google**: **Dados específicos do Google** (*Specific Google data*).
      - Escopos permitidos: **somente** `https://www.googleapis.com/auth/gmail.send`.
      - **Continuar**, revisar, **Concluir**.

      Pode ser feito logo depois da sessão do §5 (não envolve segredo). Se preferir que a política exista **antes** do
      consentimento, faça-o entre os passos 9 e 11, numa outra aba, sem fechar a tela de criação do cliente.
- [ ] **16. Se a tela não permitir isso**, pare **sem** escolher Confiável e me diga o que apareceu. Casos possíveis:
      - a pesquisa pelo ID não encontra o app → confira se está no projeto `eiff-control-email` e se o ID foi colado
        inteiro (termina em `.apps.googleusercontent.com`); se continuar sem achar, faça o passo 12 e procure de novo
        na lista de apps acessados;
      - a tela não deixa escolher o escopo, só serviços inteiros → **não** ampliar. A alternativa segura é **deixar o
        app sem configuração** nesta implantação: o token só vale para `gmail.send`, porque foi o único escopo pedido e
        concedido (o script confere), e a política fina fica para uma decisão própria;
      - aparece um aviso de que `gmail.send` é escopo de **alto risco** → é esperado (o Google o lista entre os de alto
        risco do Gmail). Escolha-o explicitamente e siga.
- [ ] **17. Não fazer nesta implantação:** restringir o Gmail para a organização inteira (**Gerenciar serviços do
      Google › Gmail › Restrito**), ligar «Limitar escopos de alto risco» do Gmail ou marcar «Confiar em apps
      internos». Essas três mudanças valem para **todos** os apps e integrações do domínio e exigem autorização própria
      da Direção.
- [ ] **18.** Anotar fora do repositório (gerenciador de senhas ou registro interno): quem fez o consentimento, data e
      hora, nome do projeto, **ID do cliente** e a política aplicada no passo 15. É o que se precisa para revogar.

## 7. Como desfazer

- **Parar de enviar na hora, sem deploy:** logado como `contato@`, `myaccount.google.com/linkedapps` › o app ›
  **Remover acesso**. O sistema passa a falhar fechado (nada sai).
- **Trocar a credencial:** passos 9 a 13 de novo; o segredo novo vem da rotação de segredo do cliente ou de um
  cliente novo.
- **Desmontar:** apagar o cliente e o projeto `eiff-control-email`; apagar as variáveis no Netlify; no Admin
  Console, remover a configuração do app (ou mudá-la para **Bloqueado**, que corta o acesso na hora).
- **Atenção:** trocar a senha de `contato@` invalida o token. Correção: passos 10 a 13.

## 8. Quem faz o quê

| Ação | Quem |
|---|---|
| Passos 2 a 18 (Admin Console, Cloud Console, script de consentimento, variáveis do Netlify, política do app) | **Augusto**, pessoalmente |
| Dizer no chat só o resultado de cada bloco («2 ok», «escopo único confirmado», «variáveis criadas») | Augusto |
| Conferir, sem ver segredo, que nada foi publicado e que o banco segue intacto | Agente, por leitura |
| Responder dúvida sobre uma tela diferente do descrito (sem prints com códigos ou segredos) | Agente |
| Ler, copiar ou testar o valor de qualquer variável | **Ninguém pelo chat.** A credencial só é testada depois da publicação, pela ação de saúde |

## 9. Depois disso

O próximo portão é a **publicação do EIFF Control** (autorização própria: «PRODUCTION AUTORIZADA»). Só depois dela a
ação de **saúde** confirma, sem enviar nada, que a credencial obtém token. O canário (modo `canary`, saída do Inbox
ligada, lista de endereços internos) e o primeiro envio de teste vêm depois, cada um com autorização própria.

Limite a conferir no primeiro teste: a política do passo 15 só é exercitada de fato quando o servidor pede um token.
Por isso a ação de **saúde**, depois da publicação, é também a prova de que a política permite `gmail.send`; se ela
falhar com acesso recusado, o primeiro suspeito é o escopo configurado no passo 15.

Fontes consultadas em 13/11/2026: documentação do Google Workspace sobre configuração da tela de consentimento e
criação de credenciais; documentação de OAuth para apps instalados e de expiração de tokens; anúncio do Google sobre
segredos do cliente mascarados (abril de 2025); central de ajuda do Admin sobre controle de acesso de apps e sobre
apps com acesso à conta.
